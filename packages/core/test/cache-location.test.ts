import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { platformCacheBase } from "../src/infra/cache-location.js";

const HOME = "/home/someone";

describe("platformCacheBase", () => {
  it("uses Library/Caches on darwin", () => {
    expect(platformCacheBase("darwin", HOME, {})).toBe(
      join(HOME, "Library", "Caches"),
    );
  });

  it("uses LOCALAPPDATA on win32 when it is set", () => {
    expect(
      platformCacheBase("win32", HOME, { LOCALAPPDATA: "C:\\Cache" }),
    ).toBe("C:\\Cache");
  });

  it("falls back to AppData/Local on win32", () => {
    expect(platformCacheBase("win32", HOME, {})).toBe(
      join(HOME, "AppData", "Local"),
    );
  });

  it("uses XDG_CACHE_HOME on linux when it is set", () => {
    expect(platformCacheBase("linux", HOME, { XDG_CACHE_HOME: "/xdg" })).toBe(
      "/xdg",
    );
  });

  it("falls back to .cache on linux", () => {
    expect(platformCacheBase("linux", HOME, {})).toBe(join(HOME, ".cache"));
  });
});
