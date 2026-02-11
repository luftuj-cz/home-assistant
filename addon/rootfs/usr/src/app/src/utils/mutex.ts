import type { Logger } from "pino";

export class Mutex {
  private queue: Promise<unknown> = Promise.resolve();

  async runExclusive<T>(task: () => Promise<T>, logger?: Logger, taskName?: string): Promise<T> {
    const meta = { taskName };
    const result = this.queue.then(async () => {
      logger?.debug(meta, "Mutex: acquiring lock");
      try {
        const val = await task();
        logger?.debug(meta, "Mutex: task completed, releasing lock");
        return val;
      } catch (err) {
        logger?.error({ ...meta, err }, "Mutex: task failed, releasing lock");
        throw err;
      }
    });

    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
