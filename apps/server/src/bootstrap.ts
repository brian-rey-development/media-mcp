import {
  type Config,
  checkFfmpeg,
  checkYtDlp,
  createMediaServices,
  loadConfig,
  ok,
  pruneExpired,
  type Result,
  runProcess,
  type Services,
} from "@media-mcp/core";
import type { Logger } from "./logger.js";

export interface Booted {
  services: Services;
  ytDlpVersion: string;
  cacheDir: string;
}

const warnIfFfmpegMissing = async (
  config: Config,
  logger: Logger,
): Promise<void> => {
  const ffmpeg = await checkFfmpeg(runProcess, config);
  if (ffmpeg.ok) return;
  const { message, hint = "" } = ffmpeg.error;
  logger.info(
    `warning, ${message}. Transcripts and video info still work, video downloads will fail until it is installed. ${hint}`.trim(),
  );
};

export const bootstrap = async (
  env: NodeJS.ProcessEnv,
  logger: Logger,
): Promise<Result<Booted>> => {
  const config = loadConfig({ env });
  if (!config.ok) return config;
  const ytDlp = await checkYtDlp(runProcess, config.value);
  if (!ytDlp.ok) return ytDlp;
  await warnIfFfmpegMissing(config.value, logger);
  void pruneExpired(config.value.cacheDir);
  const services = createMediaServices(config.value, { run: runProcess });
  return ok({
    services,
    ytDlpVersion: ytDlp.value.version,
    cacheDir: config.value.cacheDir,
  });
};
