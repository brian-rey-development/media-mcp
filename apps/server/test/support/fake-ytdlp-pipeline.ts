import {
  createMediaServices,
  loadConfig,
  runProcess,
  type Services,
} from "@media-mcp/core";
import { serverProcessEnv } from "./process-env.js";

export const fakeYtDlpEnv = (
  base: string,
  extra: Record<string, string> = {},
) => ({ ...serverProcessEnv(base), ...extra });

export const pipelineServices = (
  base: string,
  extra: Record<string, string> = {},
): Services => {
  const loaded = loadConfig({ env: fakeYtDlpEnv(base, extra) });
  if (!loaded.ok) throw new Error(loaded.error.message);
  return createMediaServices(loaded.value, { run: runProcess });
};
