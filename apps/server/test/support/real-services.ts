import {
  createMediaServices,
  err,
  loadConfig,
  type Result,
  type Services,
} from "@media-mcp/core";
import { serverProcessEnv } from "./process-env.js";

export interface RealServices {
  services: Services;
  processCalls(): number;
}

export const realServices = (base: string): RealServices => {
  const loaded = loadConfig({ env: serverProcessEnv(base) });
  if (!loaded.ok) throw new Error(loaded.error.message);
  let calls = 0;
  const run = async (): Promise<Result<{ stdout: string; stderr: string }>> => {
    calls += 1;
    return err("PROCESS_FAILED", "no process may start in this test");
  };
  return {
    services: createMediaServices(loaded.value, { run }),
    processCalls: () => calls,
  };
};
