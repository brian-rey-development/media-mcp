import { fail, type Result } from "../../domain/result.js";
import type { Config } from "../../infra/config.js";
import { type Loose, omitUndefined } from "../../infra/options.js";
import type { ProcessRunner, RunOptions } from "../../infra/process.js";
import { classifyFailure } from "./failures.js";
import { INSTALL_HINT, PROCESS_TIMEOUT_HINT } from "./hints.js";

export interface YtDlpDeps {
  run: ProcessRunner;
  config: Config;
}

export type ExecOptions = Loose<Omit<RunOptions, "missingToolHint">>;

export const execYtDlp = async (
  { run, config }: YtDlpDeps,
  args: readonly string[],
  { timeoutMs, timeoutHint, ...rest }: ExecOptions = {},
): Promise<Result<{ stdout: string; stderr: string }>> => {
  const result = await run(config.ytDlpPath, args, {
    timeoutMs: timeoutMs ?? config.processTimeoutMs,
    missingToolHint: INSTALL_HINT,
    timeoutHint: timeoutHint ?? PROCESS_TIMEOUT_HINT,
    ...omitUndefined(rest),
  });
  return result.ok ? result : fail(classifyFailure(result.error));
};
