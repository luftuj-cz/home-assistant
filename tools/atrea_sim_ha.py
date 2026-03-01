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
            if expr.startswith('0x') or expr.startswith('0X'):
                return int(expr, 16)
            return expr
        
        if isinstance(expr, dict) and "function" in expr:
            func = expr["function"]
            args = [self.eval_expr(arg) for arg in expr.get("args", [])]
            
            operations = {
                "modbus_read_holding": lambda a: self.registers.get(a[0], 0),
                "modbus_read_input": lambda a: self.registers.get(a[0], 0),
                "exclude_modbus_read_coil": lambda a: None,
                "multiply": lambda a: a[0] * a[1],
                "divide": lambda a: a[0] / a[1] if a[1] != 0 else 0,
                "bit_and": lambda a: int(a[0]) & int(a[1]),
                "bit_or": lambda a: int(a[0]) | int(a[1]),
                "bit_lshift": lambda a: int(a[0]) << int(a[1]),
                "bit_rshift": lambda a: int(a[0]) >> int(a[1]),
                "round": lambda a: round(a[0]),
                "non_zero": lambda a: bool(a[0]),
            }
            
            if func in operations:
                result = operations[func](args)
                print(f" [DSL] {func}({args}) = {result} (0x{result:04x})")
                return result
            return 0

    def _mirror_frontpanel(self, addr: int, val: int):
        """
        For units like XVent that pack power/boost/bypass into a single front panel register (0x9C40),
        mirror writes into the internal variable state so subsequent reads reflect the change.
        """
        if addr != 0x9C40:
            return

        power = (val >> 6) & 0xF
        boost = 1 if (val & 0x10) else 0
        bypass = 1 if (val & 0x4) else 0

        # Update both current and target to keep physics loop aligned
        for key, value in {
            "$power": power,
            "$boost": boost,
            "$bypass": bypass,
        }.items():
            self.variables[key] = value
            self.variables[f"{key}_target"] = value

    def execute_script(self, script: List[dict]):
        for stmt in script:
            if stmt["type"] == "assignment":
                var = stmt["variable"]
                val = self.eval_expr(stmt["value"])
                self.variables[var] = val
                print(f" [DSL] {var} = {val} (0x{val:04x})")
            elif stmt["type"] == "action":
                expr = stmt["expression"]
                func = expr["function"]
                args = [self.eval_expr(arg) for arg in expr.get("args", [])]
                
                if func == "modbus_write_holding":
                    addr = args[0]
                    val = int(args[1])
                    self.registers[addr] = val
                    self._mirror_frontpanel(addr, val)
                    print(f" [MODBUS] Write Reg {addr} = {val} (0x{val:04x})")
                elif func == "modbus_write_coil":
                    addr = args[0]
                    val = bool(args[1])
                    self.coils[addr] = val
                    print(f" [MODBUS] Write Coil {addr} = {val}")
                elif func == "modbus_write_holding_multi":
                    if not args:
                        continue
                    base_addr = int(args[0])
                    values = [int(v) for v in args[1:]] or [0]
                    for offset, val in enumerate(values):
                        addr = base_addr + offset
                        self.registers[addr] = val
                        self._mirror_frontpanel(addr, val)
                        print(f" [MODBUS] Write Reg {addr} = {val} (0x{val:04x})")

# --- Simulator State ---

class HruSimulator:
    def __init__(self, unit_code: str):
        # Cover low Modbus addresses (e.g., Korado uses 106) and typical upper range
        self.registers = {i: 0 for i in range(0, 11000)}
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
        
        self.unit_def = self.load_unit(unit_code)
        
        self.dsl = HruSimDSL(self.registers, self.coils, self.internal_state)
        self.reg_lock = threading.RLock()
        self.dirty_registers = set()
        
        print(f"[*] Loaded Unit: {self.unit_def.get('name', unit_code)}")

    def load_unit(self, code: str) -> dict:
        file_path = os.path.join(UNITS_PATH, f"{code}.json")
        if not os.path.exists(file_path):
            for filename in os.listdir(UNITS_PATH):
                if filename.endswith(".json"):
                    try:
                        with open(os.path.join(UNITS_PATH, filename), 'r') as f:
                            data = json.load(f)
                            if data.get("code") == code:
                                return data
                    except: continue
            raise FileNotFoundError(f"Unit definition for '{code}' not found in {UNITS_PATH}")
        with open(file_path, 'r') as f:
            return json.load(f)

    def sync_registers_from_state(self):
        """Update registers from internal state based on interface.read definitions"""
        read_script = (
            self.unit_def.get("integration", {}).get("read")
            or self.unit_def.get("interface", {}).get("read")
        )
        if not read_script:
            return
        for stmt in read_script:
            if stmt.get("type") != "assignment":
                continue
            var_name = stmt.get("variable")
            if not var_name or not var_name.startswith("$"):
                continue
            if var_name not in self.internal_state:
                continue
            
            val_expr = stmt.get("value", {})
            self._sync_register_from_expr(val_expr, self.internal_state[var_name])

    def _sync_register_from_expr(self, expr: Any, value: float):
        if not isinstance(expr, dict):
            return
        
        func = expr.get("function")
        if func == "modbus_read_holding":
            addr = self._resolve_addr(expr["args"][0])
            if addr == 0x9C40:
                # keep front panel register reflecting last master write
                return
            if addr not in self.dirty_registers:
                self.registers[addr] = int(value)
        elif func == "modbus_read_input":
            addr = self._resolve_addr(expr["args"][0])
            if addr == 0x9C40:
                # keep front panel register reflecting last master write
                return
            if addr not in self.dirty_registers:
                self.registers[addr] = int(value)
        elif func == "multiply":
            sub_expr = expr["args"][0]
            factor = expr["args"][1]
            if isinstance(factor, (int, float)):
                self._sync_register_from_expr(sub_expr, value / factor)
        elif func == "divide":
            sub_expr = expr["args"][0]
            factor = expr["args"][1]
            if isinstance(factor, (int, float)):
                self._sync_register_from_expr(sub_expr, value * factor)

    def _resolve_addr(self, addr: Any) -> int:
        if isinstance(addr, int):
            return addr
        if isinstance(addr, str) and addr.startswith("0x"):
            return int(addr, 16)
        return int(addr)

    def _extract_read_addresses(self) -> Dict[int, str]:
        """Extract register addresses and their target variables from interface.read"""
        result = {}
        read_script = (
            self.unit_def.get("integration", {}).get("read")
            or self.unit_def.get("interface", {}).get("read")
        )
        if not read_script:
            return result
        for stmt in read_script:
            if stmt.get("type") != "assignment":
                continue
            var_name = stmt.get("variable")
            if not var_name:
                continue
            self._collect_addresses_from_expr(stmt.get("value", {}), var_name, result)
        return result

    def _collect_addresses_from_expr(self, expr: Any, var_name: str, result: Dict[int, str]):
        if not isinstance(expr, dict):
            return
        func = expr.get("function")
        if func in ["modbus_read_holding", "modbus_read_input"]:
            addr = self._resolve_addr(expr["args"][0])
            if addr == 0x9C40:
                # keep front panel register reflecting last master write
                return
            result[addr] = var_name
        elif func in ["multiply", "divide", "bit_and", "bit_or", "bit_rshift", "bit_lshift", "non_zero"]:
            for arg in expr.get("args", []):
                if isinstance(arg, dict):
                    self._collect_addresses_from_expr(arg, var_name, result)

    def check_writes(self):
        """Detect master writes and update internal state"""
        with self.reg_lock:
            if not self.dirty_registers:
                return
            
            # Support both legacy "interface" and current "integration" definitions
            iface = self.unit_def.get("interface") or self.unit_def.get("integration") or {}
            read_script = iface.get("read", [])
            write_script = iface.get("write", [])
            if not read_script and not write_script:
                self.dirty_registers.clear()
                return
            
            addr_to_var = self._extract_read_addresses()
            
            has_delay = any(
                stmt.get("expression", {}).get("function") == "delay"
                for stmt in write_script
                if stmt.get("type") == "action"
            )
            
            if has_delay:
                for i, stmt in enumerate(write_script):
                    expr = stmt.get("expression", {})
                    if expr.get("function") == "modbus_write_holding":
                        addr = self._resolve_addr(expr["args"][0])
                        if addr == 0x9C40:
                            # keep front panel register reflecting last master write
                            continue
                        if addr in self.dirty_registers:
                            ctrl_addrs = [
                                self._resolve_addr(s.get("expression", {}).get("args", [0])[0])
                                for s in write_script
                                if s.get("expression", {}).get("function") == "modbus_write_holding"
                                and s != stmt
                            ]
                            is_ctrl = addr in ctrl_addrs[:1]
                            if is_ctrl and self.registers.get(addr) == 0:
                                continue
                            raw_val = self.registers.get(addr, 0)
                            for reg_addr, var_name in addr_to_var.items():
                                if reg_addr == addr:
                                    target_var = var_name + "_target"
                                    self.internal_state[target_var] = float(raw_val)
                                    if var_name == "$temperature":
                                        self.internal_state[target_var] = raw_val / 10.0
                                    print(f" [SIM] {var_name} setpoint -> {self.internal_state[target_var]}")
            else:
                for dirty_addr in self.dirty_registers:
                    if dirty_addr in addr_to_var:
                        var_name = addr_to_var[dirty_addr]
                        target_var = var_name + "_target"
                        val = float(self.registers.get(dirty_addr, 0))
                        # Align both current and target so physics loop and sync won't overwrite the write
                        self.internal_state[var_name] = val
                        self.internal_state[target_var] = val
                        print(f" [SIM] {var_name} changed via Master: {val}")

            # Mirror target writes into actual registers so readbacks reflect commands
            mirror_map = {10708: 10704, 10710: 10706, 10709: 10705}
            for src, dest in mirror_map.items():
                if src in self.dirty_registers:
                    val = self.registers.get(src, 0)
                    self.registers[dest] = val
                    # Also update internal state for the dest variable so sync_registers_from_state doesn't overwrite
                    if dest in addr_to_var:
                        dest_var = addr_to_var[dest]
                        self.internal_state[dest_var] = val if dest_var != "$temperature" else val / 10.0
                    print(f" [SIM] Mirror write {src} -> {dest} value {self.registers[dest]}")

            self.dirty_registers.clear()

    def physics_loop(self):
        print("[*] Realistic Physics Engine Running...")
        start_time = time.time()
        
        variables = self._extract_read_addresses()
        for addr, var_name in variables.items():
            if var_name not in self.internal_state:
                self.internal_state[var_name] = 0
            self.internal_state[var_name + "_target"] = self.internal_state.get(var_name, 0)

        while True:
            time.sleep(0.5)
            self.check_writes()

            with self.reg_lock:
                t = time.time()
                self.registers[10300] = int(120 + 20 * math.sin((t - start_time) / 60.0))
                
                for var in ["$power", "$temperature"]:
                    if var in self.internal_state:
                        target = self.internal_state.get(var + "_target", 0)
                        current = self.internal_state.get(var, 0)
                        if abs(current - target) > 0.01:
                            step = 0.5 if var == "$power" else 0.1
                            self.internal_state[var] = min(target, current + step) if target > current else max(target, current - step)

                if "$mode" in self.internal_state:
                    self.internal_state["$mode"] = self.internal_state.get("$mode_target", 0)

                self.registers[10301] = int(self.internal_state.get("$temperature", 22.0) * 10 + 2 * math.sin(t/10.0))

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

            elif frame['fc'] == 4: # Read Input Registers
                start_addr, count = struct.unpack('>HH', frame['payload'][:4])
                print(f" [MB] FC04 Read {count} input regs from {start_addr}")
                vals = []
                with sim.reg_lock:
                    for i in range(count):
                        vals.append(sim.registers.get(start_addr + i, 0))

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
                    # Immediate mirror for single write
                    mirror_map = {10708: 10704, 10710: 10706, 10709: 10705}
                    if reg_addr in mirror_map:
                        sim.registers[mirror_map[reg_addr]] = reg_val
                        print(f" [SIM] Immediate mirror {reg_addr} -> {mirror_map[reg_addr]} value {reg_val}")
                resp_payload = struct.pack('>HH', reg_addr, reg_val)

            elif frame['fc'] == 16: # Write Multiple
                start_addr, count, byte_count = struct.unpack('>HHB', frame['payload'][:5])
                vals_data = frame['payload'][5:]
                print(f" [MB] FC16 Write Multi {start_addr} count {count}")
                with sim.reg_lock:
                    mirror_map = {10708: 10704, 10710: 10706, 10709: 10705}
                    for i in range(count):
                        val = struct.unpack('>H', vals_data[i*2:(i*2)+2])[0]
                        addr = start_addr + i
                        sim.registers[addr] = val
                        sim.dirty_registers.add(addr)
                        if addr in mirror_map:
                            sim.registers[mirror_map[addr]] = val
                            print(f" [SIM] Immediate mirror {addr} -> {mirror_map[addr]} value {val}")
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
