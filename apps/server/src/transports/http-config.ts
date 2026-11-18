import { err, loadEnv, type Result } from "@media-mcp/core";
import { z } from "zod";
import { ENV } from "../env.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const MIN_PORT = 1;
const MAX_PORT = 65_535;
const MIN_TOKEN_LENGTH = 16;
const HOST_SEPARATOR = ",";

const HINTS: Readonly<Record<string, string>> = {
  [ENV.token]: `Set ${ENV.token} to a secret of at least ${MIN_TOKEN_LENGTH} characters, for example the output of openssl rand -hex 32`,
  [ENV.port]: `Set ${ENV.port} to a whole number from ${MIN_PORT} to ${MAX_PORT}`,
};
const FALLBACK_HINT = `Check the ${ENV.token}, ${ENV.host}, ${ENV.port} and ${ENV.allowedHosts} environment variables`;

const hostList = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(HOST_SEPARATOR)
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host !== ""),
  );

const EnvSchema = z.object({
  [ENV.token]: z.string().min(MIN_TOKEN_LENGTH),
  [ENV.host]: z.string().default(DEFAULT_HOST),
  [ENV.port]: z.coerce
    .number()
    .int()
    .min(MIN_PORT)
    .max(MAX_PORT)
    .default(DEFAULT_PORT),
  [ENV.allowedHosts]: hostList,
});

export interface HttpSettings {
  token: string;
  host: string;
  port: number;
  extraHosts: string[];
}

const hintFor = (message: string): string => {
  const hints = Object.entries(HINTS)
    .filter(([key]) => message.includes(key))
    .map(([, hint]) => hint);
  return hints.length > 0 ? hints.join(". ") : FALLBACK_HINT;
};

export const loadHttpSettings = (
  env: NodeJS.ProcessEnv,
): Result<HttpSettings> => {
  const loaded = loadEnv(EnvSchema, env, FALLBACK_HINT);
  if (!loaded.ok) {
    const { code, message } = loaded.error;
    return err(code, message, hintFor(message));
  }
  const values = loaded.value;
  return {
    ok: true,
    value: {
      token: values[ENV.token],
      host: values[ENV.host],
      port: values[ENV.port],
      extraHosts: values[ENV.allowedHosts],
    },
  };
};
