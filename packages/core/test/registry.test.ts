import { describe, expect, it } from "vitest";
import type { Provider } from "../src/providers/provider.js";
import { createRegistry } from "../src/providers/registry.js";
import { provider, ytDlpFake } from "./support/youtube-fake.js";

const { run } = ytDlpFake({});
const youtube = provider(run);

const otherProvider: Provider = {
  ...youtube,
  name: "other",
  matches: (url) => url.startsWith("https://other.example/"),
};

describe("createRegistry", () => {
  it("finds the YouTube provider for YouTube URLs", () => {
    const registry = createRegistry([youtube]);

    expect(registry.find("https://youtu.be/jNQXAC9IWRw")).toBe(youtube);
  });

  it("returns undefined when no provider matches", () => {
    const registry = createRegistry([youtube]);

    expect(registry.find("https://vimeo.com/1")).toBeUndefined();
    expect(registry.find("--exec=touch /tmp/x")).toBeUndefined();
  });

  it("picks the first provider that matches and lists them all", () => {
    const registry = createRegistry([otherProvider, youtube]);

    expect(registry.find("https://other.example/video")).toBe(otherProvider);
    expect(registry.find("https://youtu.be/jNQXAC9IWRw")).toBe(youtube);
    expect(registry.all).toEqual([otherProvider, youtube]);
  });
});
