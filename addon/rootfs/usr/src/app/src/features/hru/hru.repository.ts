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

      async function evaluateExpression(expr: CommandExpression): Promise<number> {
        const { function: fn, args } = expr;
        const evaluatedArgs = await Promise.all(args.map(evaluate));
        const arg0 = evaluatedArgs[0] ?? 0;
        const arg1 = evaluatedArgs[1] ?? 0;

        switch (fn) {
          case "bit_and":
            return arg0 & arg1;
          case "bit_or":
            return arg0 | arg1;
          case "bit_lshift":
            return arg0 << arg1;
          case "bit_rshift":
            return arg0 >> arg1;
          case "round":
            return Math.round(arg0);
          case "multiply":
            return arg0 * arg1;
          case "divide":
            return arg0 / (arg1 || 1);
          case "delay":
            await new Promise((resolve) => setTimeout(resolve, arg0));
            return 0;
          case "modbus_read_holding": {
            const count = arg1 || 1;
            const data = await mb.readHolding(arg0, count);
            return data[0] ?? 0;
          }
          case "modbus_read_input": {
            const count = arg1 || 1;
            const data = await mb.readInput(arg0, count);
            return data[0] ?? 0;
          }
          case "modbus_write_holding": {
            await mb.writeHolding(arg0, arg1);
            return arg1;
          }
          default:
            logger.warn(`Unknown function in HRU script: ${fn}`);
            return 0;
        }
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
