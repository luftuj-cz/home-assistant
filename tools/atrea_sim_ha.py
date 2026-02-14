import socket
import struct
import threading
import time
import math
import json
import os
import argparse
from typing import Dict, Any, List

# --- Configuration ---
HOST = '0.0.0.0'
PORT = 502

# Resolve base path relative to this script
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
# Definitions are in ../addon/rootfs/usr/src/app/src/features/hru/definitions
DEFAULT_BASE_PATH = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "addon/rootfs/usr/src/app/src/features/hru/definitions"))
BASE_PATH = os.getenv("HRU_DEFINITIONS_PATH", DEFAULT_BASE_PATH)

UNITS_PATH = os.path.join(BASE_PATH, "units")
STRATEGIES_PATH = os.path.join(BASE_PATH, "strategies")

# --- DSL Interpreter ---

class HruSimDSL:
    def __init__(self, registers: Dict[int, int], coils: Dict[int, bool], variables: Dict[str, Any]):
        self.registers = registers
        self.coils = coils
        self.variables = variables

    def eval_expr(self, expr: Any) -> Any:
        if isinstance(expr, (int, float)):
            return expr
        if isinstance(expr, str):
            if expr.startswith('$'):
                return self.variables.get(expr, 0)
            return expr # Literal string or hex? (usually handled as int in json)
        
        if isinstance(expr, dict) and "function" in expr:
            func = expr["function"]
            args = [self.eval_expr(arg) for arg in expr.get("args", [])]
            
            operations = {
                "modbus_read_holding": lambda a: self.registers.get(a[0], 0),
                "exclude_modbus_read_coil": lambda a: None,
                "multiply": lambda a: a[0] * a[1],
                "divide": lambda a: a[0] / a[1] if a[1] != 0 else 0,
                "bit_and": lambda a: int(a[0]) & int(a[1]),
                "bit_or": lambda a: int(a[0]) | int(a[1]),
                "bit_lshift": lambda a: int(a[0]) << int(a[1]),
                "bit_rshift": lambda a: int(a[0]) >> int(a[1]),
                "round": lambda a: round(a[0]),
            }
            
            if func in operations:
                return operations[func](args)
            return 0

    def execute_script(self, script: List[dict]):
        for stmt in script:
            if stmt["type"] == "assignment":
                var = stmt["variable"]
                val = self.eval_expr(stmt["value"])
                self.variables[var] = val
            elif stmt["type"] == "action":
                expr = stmt["expression"]
                func = expr["function"]
                args = [self.eval_expr(arg) for arg in expr.get("args", [])]
                
                if func == "modbus_write_holding":
                    addr = args[0]
                    val = int(args[1])
                    self.registers[addr] = val
                    print(f" [MODBUS] Write Reg {addr} = {val}")
                elif func == "modbus_write_coil":
                    addr = args[0]
                    val = bool(args[1])
                    self.coils[addr] = val
                    print(f" [MODBUS] Write Coil {addr} = {val}")

# --- Simulator State ---

class HruSimulator:
    def __init__(self, unit_code: str):
        self.registers = {i: 0 for i in range(1000, 11000)} # Large enough for most
        self.coils = {} # Coils state
        # Add some default values for realism
        self.registers[10300] = 120 # Outdoor 12.0
        self.registers[10301] = 220 # Supply 22.0
        
        self.internal_state = {
            "$power": 0.0,
            "$temperature": 22.5,
            "$mode": 2.0,
            "$rawTemp": 225.0
        }
        
        self.unit_def = self.load_json(UNITS_PATH, unit_code)
        self.strategy_def = self.load_json(STRATEGIES_PATH, self.unit_def["regulationTypeId"], is_strategy=True)
        
        self.dsl = HruSimDSL(self.registers, self.coils, self.internal_state)
        self.reg_lock = threading.RLock()
        self.dirty_registers = set() # Track registers written by master
        
        print(f"[*] Loaded Unit: {self.unit_def.get('name', unit_code)}")
        print(f"[*] Loaded Strategy: {self.strategy_def.get('id', 'unknown')}")

    def load_json(self, path: str, code: str, is_strategy: bool = False) -> dict:
        if not is_strategy:
            file_path = os.path.join(path, f"{code}.json")
            if not os.path.exists(file_path):
                # Try finding by 'code' field inside
                for filename in os.listdir(path):
                    if filename.endswith(".json"):
                        try:
                            with open(os.path.join(path, filename), 'r') as f:
                                data = json.load(f)
                                if data.get("code") == code:
                                    return data
                        except: continue
                raise FileNotFoundError(f"Unit definition for '{code}' not found in {path}")
            with open(file_path, 'r') as f:
                return json.load(f)
        
        # Strategy resolution: scan directory for matching "id"
        for filename in os.listdir(path):
            if filename.endswith(".json"):
                try:
                    with open(os.path.join(path, filename), 'r') as f:
                        data = json.load(f)
                        if data.get("id") == code:
                            return data
                except:
                    continue
        
        raise FileNotFoundError(f"Strategy with ID '{code}' not found in {path}")

    def sync_registers_from_state(self):
        """Update Read registers from internal state using strategy DSL"""
        # Only sync if master hasn't touched these registers recently
        if "powerCommands" in self.strategy_def:
            raw_power = self.internal_state["$power"]
            if self.strategy_def["id"] == "xvent":
                addr = 40000
                if addr not in self.dirty_registers:
                    current = self.registers.get(addr, 0)
                    mask = ~(15 << 6)
                    self.registers[addr] = (current & mask) | ((int(raw_power) & 15) << 6)
            else:
                self.sync_component("powerCommands", "$power")
        
        self.sync_component("temperatureCommands", "$temperature")
        self.sync_component("modeCommands", "$mode")

    def sync_component(self, cmd_group: str, var_name: str):
        if cmd_group not in self.strategy_def: return
        
        for stmt in self.strategy_def[cmd_group]["read"]:
            if stmt["type"] == "assignment" and stmt["variable"] == var_name:
                val_expr = stmt["value"]
                if val_expr.get("function") == "modbus_read_holding":
                    addr = val_expr["args"][0]
                    if addr not in self.dirty_registers:
                        self.registers[addr] = int(self.internal_state[var_name])
                        if var_name == "$power": # Debug log for power sync
                             pass
                elif val_expr.get("function") in ["multiply", "divide"]:
                    # Handle both direct modbus_read and aliased variables (like RD5 temp)
                    sub_expr = val_expr["args"][0]
                    factor = val_expr["args"][1]
                    addr = None
                    
                    if isinstance(sub_expr, dict) and sub_expr.get("function") == "modbus_read_holding":
                        addr = sub_expr["args"][0]
                    elif isinstance(sub_expr, str) and sub_expr.startswith("$"):
                        # Trace back to find the address for this variable in the same read script
                        for prev_stmt in self.strategy_def[cmd_group]["read"]:
                            if prev_stmt.get("variable") == sub_expr:
                                prev_val = prev_stmt.get("value", {})
                                if prev_val.get("function") == "modbus_read_holding":
                                    addr = prev_val["args"][0]
                                    break
                    
                    if addr is not None and addr not in self.dirty_registers:
                        if val_expr["function"] == "multiply":
                            self.registers[addr] = int(round(self.internal_state[var_name] / factor))
                        else:
                            self.registers[addr] = int(round(self.internal_state[var_name] * factor))

    def check_writes(self):
        """Detect master writes and update internal state"""
        with self.reg_lock:
            if not self.dirty_registers: return

            for cmd_group in ["powerCommands", "temperatureCommands", "modeCommands"]:
                if cmd_group not in self.strategy_def: continue
                
                write_script = self.strategy_def[cmd_group]["write"]
                has_trigger = any(stmt.get("expression", {}).get("function") == "delay" for stmt in write_script)
                
                if has_trigger:
                    # RD5: Watch for control register = 0
                    ctrl_addr = write_script[0]["expression"]["args"][0]
                    if ctrl_addr in self.dirty_registers and self.registers.get(ctrl_addr) == 0:
                        var_name = "$" + cmd_group.split("Commands")[0]
                        target_addr = write_script[-1]["expression"]["args"][0]
                        raw_val = self.registers.get(target_addr, 0)
                        
                        self.internal_state[var_name + "_target"] = float(raw_val)
                        if var_name == "$temperature":
                            self.internal_state[var_name + "_target"] /= 10.0
                            
                        print(f" [SIM] RD5 {var_name} setpoint -> {self.internal_state[var_name + '_target']}")
                        self.registers[ctrl_addr] = 1 # Auto-reset trigger
                else:
                    # AM/XVent: Detect if master wrote to any register used in reading
                    var_name = "$" + cmd_group.split("Commands")[0]
                    read_val_expr = self.strategy_def[cmd_group]["read"][0]["value"]
                    
                    # Heuristic: if any register in the read script is dirty, re-evaluate
                    # For simplicity, we just execute the read script from current registers
                    current_val_from_regs = self.dsl.eval_expr(read_val_expr)
                    if abs(current_val_from_regs - self.internal_state[var_name + "_target"]) > 0.001:
                         # Ensure this was actually a master write by checking dirty registers
                         # (Wait, if we just sync-back it won't be in dirty_registers)
                         print(f" [SIM] {var_name} setpoint changed via Master: {current_val_from_regs}")
                         self.internal_state[var_name + "_target"] = float(current_val_from_regs)

            self.dirty_registers.clear()

    def physics_loop(self):
        print("[*] Realistic Physics Engine Running...")
        start_time = time.time()
        
        # Initialize targets
        for var in ["$power", "$temperature", "$mode"]:
            self.internal_state[var + "_target"] = self.internal_state.get(var, 0)

        while True:
            time.sleep(0.5)
            self.check_writes()

            with self.reg_lock:
                t = time.time()
                # Update outdoor temp (generic address if possible, else 10300)
                outdoor_addr = 10300 if self.strategy_def["id"] == "atrea-rd5" else 10300
                self.registers[outdoor_addr] = int(120 + 20 * math.sin((t - start_time) / 60.0))
                
                for var in ["$power", "$temperature"]:
                    target = self.internal_state[var + "_target"]
                    current = self.internal_state[var]
                    if abs(current - target) > 0.01:
                        step = 0.5 if var == "$power" else 0.1
                        self.internal_state[var] = min(target, current + step) if target > current else max(target, current - step)

                self.internal_state["$mode"] = self.internal_state["$mode_target"]

                # Supply temp simulation (reaction to power/temperature settings)
                # For RD5, we update 10706 via sync_registers_from_state, but we can also fake 10301
                self.registers[10301] = int(self.internal_state["$temperature"] * 10 + 2 * math.sin(t/10.0))

                self.sync_registers_from_state()

# --- Network Handlers ---

def parse_mbap(data):
    if len(data) < 8: return None
    tid, pid, length, uid, fc = struct.unpack('>HHHBB', data[:8])
    return {'tid':tid, 'pid':pid, 'len':length, 'uid':uid, 'fc':fc, 'payload':data[8:]}

def handle_client(conn, addr, sim: HruSimulator):
    print(f"[+] Client connected from {addr}")
    try:
        while True:
            data = conn.recv(1024)
            if not data: break

            frame = parse_mbap(data)
            if not frame: continue

            resp_payload = b''

            if frame['fc'] == 1: # Read Coils
                start_addr, count = struct.unpack('>HH', frame['payload'][:4])
                print(f" [MB] FC01 Read Coils {start_addr} count {count}")
                
                # Logic to pack bits into bytes
                vals = []
                with sim.reg_lock:
                    for i in range(count):
                        vals.append(sim.coils.get(start_addr + i, False))
                
                byte_count = (count + 7) // 8
                resp_payload = struct.pack('B', byte_count)
                
                current_byte = 0
                bit_pos = 0
                packed_bytes = bytearray()
                
                for val in vals:
                    if val:
                        current_byte |= (1 << bit_pos)
                    bit_pos += 1
                    if bit_pos == 8:
                        packed_bytes.append(current_byte)
                        current_byte = 0
                        bit_pos = 0
                if bit_pos > 0:
                    packed_bytes.append(current_byte)
                
                resp_payload += packed_bytes
                
            elif frame['fc'] == 3: # Read Holding
                start_addr, count = struct.unpack('>HH', frame['payload'][:4])
                print(f" [MB] FC03 Read {count} regs from {start_addr}")
                vals = []
                with sim.reg_lock:
                    for i in range(count):
                        vals.append(sim.registers.get(start_addr + i, 0))
                
                # Modbus byte count is 1 byte, max 255. 
                # FC03 usually allows max 125 registers (250 bytes).
                actual_count = min(count, 125)
                byte_count = actual_count * 2
                resp_payload = struct.pack('B', byte_count)
                print(f"   -> Returning: {vals[:actual_count]}")
                for i in range(actual_count):
                    resp_payload += struct.pack('>H', int(vals[i]) & 0xFFFF)

            elif frame['fc'] == 5: # Write Single Coil
                reg_addr, reg_val = struct.unpack('>HH', frame['payload'][:4])
                is_on = (reg_val == 0xFF00)
                print(f" [MB] FC05 Write Coil {reg_addr} = {'ON' if is_on else 'OFF'}")
                if reg_addr == 31: # KORADO KeepAlive specific log
                     print(f" [KEEP-ALIVE] Received heartbeat on coil 31")

                with sim.reg_lock:
                    sim.coils[reg_addr] = is_on
                resp_payload = struct.pack('>HH', reg_addr, reg_val)

            elif frame['fc'] == 6: # Write Single
                reg_addr, reg_val = struct.unpack('>HH', frame['payload'][:4])
                print(f" [MB] FC06 Write Reg {reg_addr} = {reg_val}")
                with sim.reg_lock:
                    sim.registers[reg_addr] = reg_val
                    sim.dirty_registers.add(reg_addr)
                resp_payload = struct.pack('>HH', reg_addr, reg_val)

            elif frame['fc'] == 16: # Write Multiple
                start_addr, count, byte_count = struct.unpack('>HHB', frame['payload'][:5])
                vals_data = frame['payload'][5:]
                print(f" [MB] FC16 Write Multi {start_addr} count {count}")
                with sim.reg_lock:
                    for i in range(count):
                        val = struct.unpack('>H', vals_data[i*2:(i*2)+2])[0]
                        sim.registers[start_addr + i] = val
                        sim.dirty_registers.add(start_addr + i)
                resp_payload = struct.pack('>HH', start_addr, count)

            if resp_payload:
                resp_len = 1 + 1 + len(resp_payload)
                header = struct.pack('>HHHBB', frame['tid'], frame['pid'], resp_len, frame['uid'], frame['fc'])
                conn.sendall(header + resp_payload)

    except Exception as e:
        print(f"[-] Connection Error: {e}")
    finally:
        conn.close()

def main():
    parser = argparse.ArgumentParser(description='Atrea HRU Simulator (Dynamic)')
    parser.add_argument('--unit', type=str, default='atrea-rd5-cf', help='Unit code (from units json)')
    parser.add_argument('--port', type=int, default=502, help='Modbus port')
    parser.add_argument('--host', type=str, default='0.0.0.0', help='Bind address (default 0.0.0.0)')
    args = parser.parse_args()

    sim = HruSimulator(args.unit)
    
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    
    try:
        server.bind((args.host, args.port))
    except (PermissionError, OSError) as e:
        print(f"!!! Error: Could not bind to port {args.port}: {e}")
        if args.port == 502:
            print("Tip: Run with sudo or use --port 5020")
        return

    server.listen(5)
    print(f"==========================================")
    print(f" DYNAMIC HRU SIMULATOR")
    print(f" Unit: {sim.unit_def['name']}")
    print(f" Strategy: {sim.strategy_def['id']}")
    print(f" Listen: {HOST}:{args.port}")
    print(f"==========================================")

    # Background physics
    threading.Thread(target=sim.physics_loop, daemon=True).start()

    try:
        while True:
            conn, addr = server.accept()
            threading.Thread(target=handle_client, args=(conn, addr, sim), daemon=True).start()
    except KeyboardInterrupt:
        print("\nStopping...")
        server.close()

if __name__ == '__main__':
    main()
