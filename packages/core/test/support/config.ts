import type { Config } from "../../src/infra/config.js";

export const PROCESS_TIMEOUT_MS = 5_000;
export const DOWNLOAD_TIMEOUT_MS = 60_000;
export const MAX_DOWNLOAD_BYTES = 5_000_000;
export const TEST_BUDGET = 1_000;

export const testConfig: Config = {
  ytDlpPath: "yt-dlp",
  outputRoot: "/unused/output",
  cacheDir: "/unused/cache",
  concurrency: 2,
  transcriptCharBudget: TEST_BUDGET,
  transcriptTtlMs: 1_000,
  processTimeoutMs: PROCESS_TIMEOUT_MS,
  downloadTimeoutMs: DOWNLOAD_TIMEOUT_MS,
  maxDownloadBytes: MAX_DOWNLOAD_BYTES,
  infoTtlMs: 1_000,
};
