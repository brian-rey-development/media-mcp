import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createMemoryCache } from "../src/services/memory-cache.js";
import { fakeClock } from "./support/fake-clock.js";

const TTL_MS = 10;
const NumberSchema = z.number();

describe("createMemoryCache", () => {
  it("returns a value until its time to live has passed", async () => {
    const { clock, state } = fakeClock();
    const cache = createMemoryCache(clock);

    await cache.set("a", 1, TTL_MS);
    state.time = TTL_MS - 1;
    const fresh = await cache.get("a", NumberSchema);
    state.time = TTL_MS;
    const expired = await cache.get("a", NumberSchema);

    expect([fresh, expired]).toEqual([1, undefined]);
  });

  it("ignores a stored value that does not fit the schema", async () => {
    const cache = createMemoryCache(fakeClock().clock);

    await cache.set("a", "not a number", TTL_MS);

    expect(await cache.get("a", NumberSchema)).toBeUndefined();
  });

  it("drops expired entries when it writes, so memory stays bounded", async () => {
    const { clock, state } = fakeClock();
    const cache = createMemoryCache(clock);
    await cache.set("old", 1, TTL_MS);

    state.time = TTL_MS * 2;
    await cache.set("new", 2, TTL_MS);
    state.time = 0;

    expect(await cache.get("old", NumberSchema)).toBeUndefined();
    expect(await cache.get("new", NumberSchema)).toBe(2);
  });
});
