import { describe, expect, it, vi } from "vitest";
import { err, ok } from "../src/domain/result.js";
import { runBatch } from "../src/infra/batch.js";

describe("runBatch", () => {
  it("keeps results in input order regardless of completion order", async () => {
    const gates = [0, 1, 2].map(() => Promise.withResolvers<void>());
    const completed: number[] = [];

    const pending = runBatch([0, 1, 2], async (index) => {
      await gates[index]?.promise;
      completed.push(index);
      return ok(index * 2);
    });
    for (const index of [2, 0, 1]) {
      gates[index]?.resolve();
      await vi.waitFor(() => expect(completed).toContain(index));
    }

    expect(completed).toEqual([2, 0, 1]);
    expect(await pending).toEqual([
      { input: 0, result: ok(0) },
      { input: 1, result: ok(2) },
      { input: 2, result: ok(4) },
    ]);
  });

  it("keeps going when a worker returns an error", async () => {
    const results = await runBatch([1, 2, 3], async (n) =>
      n === 2 ? err("NO_CAPTIONS", "none") : ok(n),
    );

    expect(results.map((item) => item.result.ok)).toEqual([true, false, true]);
  });

  it("turns a thrown error into a PROCESS_FAILED entry without stopping the others", async () => {
    const results = await runBatch([1, 2, 3], async (n) => {
      if (n === 2) throw new Error("kaboom");
      return ok(n);
    });

    expect(results[1]?.result).toMatchObject({
      ok: false,
      error: { code: "PROCESS_FAILED", message: "kaboom" },
    });
    expect(results[0]?.result.ok).toBe(true);
    expect(results[2]?.result.ok).toBe(true);
  });

  it("answers every item CANCELLED without running a worker when the signal is already aborted", async () => {
    const worker = vi.fn(async (n: number) => ok(n));

    const results = await runBatch([1, 2, 3], worker, AbortSignal.abort());

    expect(worker).not.toHaveBeenCalled();
    expect(results.map((item) => item.result)).toEqual([
      err("CANCELLED", "Cancelled before it started"),
      err("CANCELLED", "Cancelled before it started"),
      err("CANCELLED", "Cancelled before it started"),
    ]);
  });
});
