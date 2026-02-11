import type { Logger } from "pino";
import { withTempModbusClient } from "../../shared/modbus/client";
import type { CommandScript, CommandValue, CommandExpression } from "./hru.definitions";

export class HruRepository {
  constructor(private readonly logger: Logger) {}

  async executeScript(
    config: { host: string; port: number; unitId: number },
    script: CommandScript,
    initialVariables: Record<string, number> = {},
  ): Promise<Record<string, number>> {
    const variables: Record<string, number> = { ...initialVariables };

    return withTempModbusClient(config, this.logger, async (mb) => {
      const logger = this.logger;
      // Helper to evaluate a value or expression
      async function evaluate(val: CommandValue): Promise<number> {
        if (typeof val === "number") return val;

        if (typeof val === "string") {
          if (val.startsWith("0x")) return parseInt(val, 16);
          if (val.startsWith("$")) {
            return variables[val] ?? 0;
          }
          return Number(val) || 0;
        }
        return evaluateExpression(val);
      }

      const handlers: Record<string, (args: number[]) => Promise<number> | number> = {
        bit_and: async ([a = 0, b = 0]) => a & b,
        bit_or: async ([a = 0, b = 0]) => a | b,
        bit_lshift: async ([a = 0, b = 0]) => a << b,
        bit_rshift: async ([a = 0, b = 0]) => a >> b,
        round: async ([a = 0]) => Math.round(a),
        multiply: async ([a = 0, b = 0]) => a * b,
        divide: async ([a = 0, b = 0]) => a / (b || 1),
        delay: async ([ms = 0]) => {
          await new Promise((resolve) => setTimeout(resolve, ms));
          return 0;
        },
        modbus_read_holding: async ([addr = 0, count = 1]) => {
          const data = await mb.readHolding(addr, count);
          return data[0] ?? 0;
        },
        modbus_read_input: async ([addr = 0, count = 1]) => {
          const data = await mb.readInput(addr, count);
          return data[0] ?? 0;
        },
        modbus_write_holding_multi: async (args) => {
          const addr = args[0] ?? 0;
          const values = args.slice(1);
          await mb.writeHolding(addr, values);
          return args[1] ?? 0;
        },
        modbus_write_holding: async ([addr = 0, val = 0]) => {
          await mb.writeHolding(addr, val);
          return val;
        },
        modbus_write_coil: async ([addr = 0, val = 0]) => {
          await mb.writeCoil(addr, val);
          return val;
        },
      };

      async function evaluateExpression(expr: CommandExpression): Promise<number> {
        const { function: fn, args } = expr;
        const evaluatedArgs = await Promise.all(args.map(evaluate));

        const handler = handlers[fn];
        if (handler) {
          return handler(evaluatedArgs);
        }

        logger.warn(`Unknown function in HRU script: ${fn}`);
        return 0;
      }

      for (const step of script) {
        if (step.type === "assignment") {
          variables[step.variable] = await evaluate(step.value);
        } else if (step.type === "action") {
          await evaluateExpression(step.expression);
        }
      }

      return variables;
    });
  }
}
