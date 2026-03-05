import { describe, expect, test } from "vitest";
import { Mutex } from "../../src/utils/mutex.js";

describe("Mutex", () => {
  test("should serialize tasks", async () => {
    const mutex = new Mutex();
    const order: number[] = [];

    async function task1() {
      await new Promise((resolve) => setTimeout(resolve, 50));
      order.push(1);
      return 1;
    }

    async function task2() {
      await new Promise((resolve) => setTimeout(resolve, 10)); // Faster but scheduled later
      order.push(2);
      return 2;
    }

    const p1 = mutex.runExclusive(task1);
    const p2 = mutex.runExclusive(task2);

    await Promise.all([p1, p2]);

    expect(order).toEqual([1, 2]);
  });

  test("should continue even if a task fails", async () => {
    const mutex = new Mutex();
    const order: number[] = [];

    async function task1() {
      throw new Error("fail");
    }

    async function task2() {
      order.push(2);
      return 2;
    }

    try {
      await mutex.runExclusive(task1);
    } catch {
      // ignore
    }

    await mutex.runExclusive(task2);

    expect(order).toEqual([2]);
  });
});
