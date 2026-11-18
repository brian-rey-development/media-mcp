import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const FAKE_YTDLP_VERSION = "2026.10.26";

export const FAKE_YT_DLP = fileURLToPath(
  new URL("../fixtures/fake-yt-dlp.mjs", import.meta.url),
);

export const serverProcessEnv = (
  directory: string,
  ytDlpPath: string = FAKE_YT_DLP,
) => ({
  MEDIA_MCP_YTDLP_PATH: ytDlpPath,
  MEDIA_MCP_CACHE_DIR: join(directory, "cache"),
  MEDIA_MCP_OUTPUT_DIR: join(directory, "out"),
});
