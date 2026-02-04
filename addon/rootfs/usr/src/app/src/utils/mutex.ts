export class Mutex {
  private queue: Promise<unknown> = Promise.resolve();

  async runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
