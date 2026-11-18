import { homedir } from "node:os";
import { isAbsolute, join, parse } from "node:path";
import { z } from "zod";
import { err, ok, type Result } from "../domain/result.js";
import { platformCacheBase } from "./cache-location.js";
import { BYTES_PER_GIB, MS_PER_DAY, MS_PER_MINUTE } from "./units.js";

const APP_DIR_NAME = "media-mcp";
const DEFAULT_YT_DLP_PATH = "yt-dlp";
const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 16;
const DEFAULT_CHAR_BUDGET = 20_000;
const MAX_CHAR_BUDGET = 1_000_000;
const DEFAULT_PROCESS_TIMEOUT_MS = 2 * MS_PER_MINUTE;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30 * MS_PER_MINUTE;
const MAX_TIMER_MS = 2 ** 31 - 1;
const DEFAULT_INFO_TTL_MS = MS_PER_DAY;
const DEFAULT_TRANSCRIPT_TTL_DAYS = 30;
const DEFAULT_MAX_DOWNLOAD_BYTES = 2 * BYTES_PER_GIB;

export const ENV_PREFIX = "MEDIA_MCP_";

export const ENV = {
  ytDlpPath: "MEDIA_MCP_YTDLP_PATH",
  outputDir: "MEDIA_MCP_OUTPUT_DIR",
  cacheDir: "MEDIA_MCP_CACHE_DIR",
  concurrency: "MEDIA_MCP_CONCURRENCY",
  charBudget: "MEDIA_MCP_CHAR_BUDGET",
  processTimeoutMs: "MEDIA_MCP_PROCESS_TIMEOUT_MS",
  downloadTimeoutMs: "MEDIA_MCP_DOWNLOAD_TIMEOUT_MS",
  maxDownloadBytes: "MEDIA_MCP_MAX_DOWNLOAD_BYTES",
  infoTtlMs: "MEDIA_MCP_INFO_TTL_MS",
  transcriptTtlDays: "MEDIA_MCP_TRANSCRIPT_TTL_DAYS",
} as const;

const positiveInt = z.coerce.number().int().positive();
const absolutePath = z
  .string()
  .refine(isAbsolute, { message: "must be an absolute path" });
const outputDirectory = absolutePath.refine(
  (path) => path !== parse(path).root,
  { message: "must not be the filesystem root" },
);

const EnvSchema = z.object({
  [ENV.ytDlpPath]: z.string().default(DEFAULT_YT_DLP_PATH),
  [ENV.outputDir]: outputDirectory.optional(),
  [ENV.cacheDir]: absolutePath.optional(),
  [ENV.concurrency]: positiveInt
    .max(MAX_CONCURRENCY)
    .default(DEFAULT_CONCURRENCY),
  [ENV.charBudget]: positiveInt
    .max(MAX_CHAR_BUDGET)
    .default(DEFAULT_CHAR_BUDGET),
  [ENV.processTimeoutMs]: positiveInt
    .max(MAX_TIMER_MS)
    .default(DEFAULT_PROCESS_TIMEOUT_MS),
  [ENV.downloadTimeoutMs]: positiveInt
    .max(MAX_TIMER_MS)
    .default(DEFAULT_DOWNLOAD_TIMEOUT_MS),
  [ENV.maxDownloadBytes]: positiveInt.default(DEFAULT_MAX_DOWNLOAD_BYTES),
  [ENV.infoTtlMs]: positiveInt.default(DEFAULT_INFO_TTL_MS),
  [ENV.transcriptTtlDays]: positiveInt.default(DEFAULT_TRANSCRIPT_TTL_DAYS),
});

export interface Config {
  ytDlpPath: string;
  outputRoot: string;
  cacheDir: string;
  concurrency: number;
  transcriptCharBudget: number;
  transcriptTtlMs: number;
  infoTtlMs: number;
  processTimeoutMs: number;
  downloadTimeoutMs: number;
  maxDownloadBytes: number;
}

interface ConfigSource {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
}

const withoutEmptyValues = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));

const summarizeIssues = (error: z.ZodError): string =>
  error.issues
    .map(({ path, message }) => `${path.join(".")}: ${message}`)
    .join("; ");

const buildConfig = (
  values: z.output<typeof EnvSchema>,
  home: string,
  cacheBase: string,
): Config => ({
  ytDlpPath: values[ENV.ytDlpPath],
  outputRoot: values[ENV.outputDir] ?? join(home, "Downloads", APP_DIR_NAME),
  cacheDir: values[ENV.cacheDir] ?? join(cacheBase, APP_DIR_NAME),
  concurrency: values[ENV.concurrency],
  transcriptCharBudget: values[ENV.charBudget],
  transcriptTtlMs: values[ENV.transcriptTtlDays] * MS_PER_DAY,
  infoTtlMs: values[ENV.infoTtlMs],
  processTimeoutMs: values[ENV.processTimeoutMs],
  downloadTimeoutMs: values[ENV.downloadTimeoutMs],
  maxDownloadBytes: values[ENV.maxDownloadBytes],
});

export const loadEnv = <Schema extends z.ZodType>(
  schema: Schema,
  env: NodeJS.ProcessEnv,
  hint = `Check the ${ENV_PREFIX}* environment variables`,
): Result<z.output<Schema>> => {
  const parsed = schema.safeParse(withoutEmptyValues(env));
  return parsed.success
    ? ok(parsed.data)
    : err(
        "CONFIG_INVALID",
        `Invalid configuration, ${summarizeIssues(parsed.error)}`,
        hint,
      );
};

export const loadConfig = ({
  env = process.env,
  platform = process.platform,
  home = homedir(),
}: ConfigSource = {}): Result<Config> => {
  const parsed = loadEnv(EnvSchema, env);
  if (!parsed.ok) return parsed;
  const cacheBase = platformCacheBase(platform, home, withoutEmptyValues(env));
  return ok(buildConfig(parsed.value, home, cacheBase));
};
