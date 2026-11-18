import { describe, expect, it } from "vitest";
import { loadHttpSettings } from "../src/transports/http-config.js";

const VALID_TOKEN = "0123456789abcdef";

const TOKEN_KEY = "MEDIA_MCP_HTTP_TOKEN";
const PORT_KEY = "MEDIA_MCP_HTTP_PORT";

const errorFor = (env: NodeJS.ProcessEnv) => {
  const loaded = loadHttpSettings(env);
  if (loaded.ok) throw new Error("expected the settings to be rejected");
  return { message: loaded.error.message, hint: loaded.error.hint ?? "" };
};

describe("HTTP settings", () => {
  it("defaults to loopback on port 8787 with no extra hosts", () => {
    const loaded = loadHttpSettings({ MEDIA_MCP_HTTP_TOKEN: VALID_TOKEN });

    expect(loaded).toEqual({
      ok: true,
      value: {
        token: VALID_TOKEN,
        host: "127.0.0.1",
        port: 8787,
        extraHosts: [],
      },
    });
  });

  it("reads the host, the port and a comma separated list of extra hosts", () => {
    const loaded = loadHttpSettings({
      MEDIA_MCP_HTTP_TOKEN: VALID_TOKEN,
      MEDIA_MCP_HTTP_HOST: "0.0.0.0",
      MEDIA_MCP_HTTP_PORT: "9000",
      MEDIA_MCP_HTTP_ALLOWED_HOSTS: " Media.Example.com , ,other.example.com ",
    });

    expect(loaded).toMatchObject({
      ok: true,
      value: {
        host: "0.0.0.0",
        port: 9000,
        extraHosts: ["media.example.com", "other.example.com"],
      },
    });
  });

  it("asks for the token when it is missing or empty", () => {
    for (const env of [{}, { [TOKEN_KEY]: "" }]) {
      const { message, hint } = errorFor(env);

      expect(message).toContain(TOKEN_KEY);
      expect(hint).toContain("openssl rand -hex 32");
    }
  });

  it("rejects a short token without repeating it", () => {
    const short = "short-secret";

    const { message, hint } = errorFor({ [TOKEN_KEY]: short });

    expect(message).toContain(TOKEN_KEY);
    expect(`${message} ${hint}`).not.toContain(short);
  });

  it.each(["0", "65536", "-1", "80.5", "http"])(
    "rejects the port %s and explains the port, not the token",
    (port) => {
      const { message, hint } = errorFor({
        [TOKEN_KEY]: VALID_TOKEN,
        [PORT_KEY]: port,
      });

      expect(message).toContain(PORT_KEY);
      expect(message).not.toContain(TOKEN_KEY);
      expect(hint).toContain("from 1 to 65535");
      expect(hint).not.toContain(TOKEN_KEY);
    },
  );

  it("explains both settings when both are wrong", () => {
    const { message, hint } = errorFor({
      [TOKEN_KEY]: "short",
      [PORT_KEY]: "0",
    });

    expect(message).toContain(TOKEN_KEY);
    expect(message).toContain(PORT_KEY);
    expect(hint).toContain("openssl rand -hex 32");
    expect(hint).toContain("from 1 to 65535");
  });
});
