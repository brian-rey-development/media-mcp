import { ENV } from "../../infra/config.js";

const YT_DLP_INSTALL_URL = "https://github.com/yt-dlp/yt-dlp/wiki/Installation";
const FFMPEG_DOWNLOAD_URL = "https://ffmpeg.org/download.html";

export const INSTALL_HINT = `Install yt-dlp (macOS users can run brew install yt-dlp, other systems are covered at ${YT_DLP_INSTALL_URL}). If yt-dlp is installed but not on the PATH of the app that started this server, set ${ENV.ytDlpPath} to its absolute path`;

const UPGRADE_INSTRUCTION = `macOS users can run brew upgrade yt-dlp, other systems are covered at ${YT_DLP_INSTALL_URL}`;

export const UPGRADE_HINT = `Update yt-dlp (${UPGRADE_INSTRUCTION})`;

export const RETRY_HINT = `Retry. If it keeps failing, update yt-dlp (${UPGRADE_INSTRUCTION})`;

export const OUTPUT_CHANGED_HINT = `${UPGRADE_HINT}, its JSON output may have changed`;

export const FFMPEG_INSTALL_HINT = `Install ffmpeg (macOS users can run brew install ffmpeg, other systems are covered at ${FFMPEG_DOWNLOAD_URL}) and make sure it is on the PATH`;

export const NODE_RUNTIME_HINT = `${UPGRADE_HINT}. YouTube needs a JavaScript runtime and this server hands yt-dlp the Node.js it runs on, so also check that node still exists at that path`;

export const VIDEO_UNAVAILABLE_HINT =
  "The video is private, removed, age-restricted or blocked in this region";

export const BOT_CHECK_HINT =
  "YouTube asked this connection to prove it is not a bot and signing in is not supported. Retry later, or from another network";

export const THROTTLED_HINT =
  "YouTube is throttling requests, wait a few minutes and retry";

export const DISK_SPACE_HINT = `Free up disk space or point ${ENV.outputDir} at a larger disk`;

export const PROCESS_TIMEOUT_HINT = `Retry, or raise ${ENV.processTimeoutMs} if the connection is slow`;

export const DOWNLOAD_TIMEOUT_HINT = `Retry, choose a lower quality, or raise ${ENV.downloadTimeoutMs}`;

export const SIZE_LIMIT_HINT = `Choose a lower quality or raise ${ENV.maxDownloadBytes}`;
