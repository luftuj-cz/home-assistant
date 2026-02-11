import type { Logger } from "pino";

export function resolveModeValue(values: Record<number, string>, mode: number | string) {
  if (typeof mode === "number") {
    return mode;
  }
  const entry = Object.entries(values).find(([, name]) => name === mode);
  if (entry) {
    return Number(entry[0]);
  }
  const parsed = Number.parseInt(String(mode), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function applyWriteDefinition(
  mb: {
    writeHolding: (address: number, value: number) => Promise<void>;
  },
  writeDef: {
    steps: Array<{
      address: number;
      kind: "holding" | "input";
      value: number | ((input: number) => number);
      delayMs?: number;
    }>;
  },
  inputValue: number,
  logger?: Logger,
) {
  try {
    for (const [index, step] of writeDef.steps.entries()) {
      const value = typeof step.value === "function" ? step.value(inputValue) : step.value;

      logger?.debug(
        {
          address: step.address,
          kind: step.kind,
          value,
          step: index + 1,
          total: writeDef.steps.length,
        },
        "HRU Write Utility: Executing step",
      );

      // Both kind='input' and kind='holding' currently use writeHolding
      // as they refer to the register type in the HRU but are written via Modbus Holding registers
      await mb.writeHolding(step.address, value);

      if (step.delayMs) {
        logger?.debug({ delayMs: step.delayMs }, "HRU Write Utility: Delaying before next step");
        await new Promise((resolve) => setTimeout(resolve, step.delayMs));
      }
    }
    logger?.info("HRU Write Utility: Write definition applied successfully");
  } catch (err) {
    logger?.error({ err }, "HRU Write Utility: Failed to apply write definition");
    throw err;
  }
}
