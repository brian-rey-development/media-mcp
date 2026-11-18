import { ok, type Result } from "../../src/domain/result.js";
import type { ProcessRunner, RunOptions } from "../../src/infra/process.js";

export { valueAfter } from "./caption-emulation.js";

export interface RecordedCall {
  command: string;
  args: readonly string[];
  options: RunOptions;
}

type Outcome = Result<{ stdout: string; stderr: string }>;

export const createFakeRunner = (
  handler: (call: RecordedCall) => Outcome | Promise<Outcome>,
) => {
  const calls: RecordedCall[] = [];
  const run: ProcessRunner = async (command, args, options) => {
    const call = { command, args, options };
    calls.push(call);
    return handler(call);
  };
  return { run, calls };
};

export const firstCall = (calls: readonly RecordedCall[]): RecordedCall => {
  const [call] = calls;
  if (!call) throw new Error("the runner was never called");
  return call;
};

export const stdoutOf = (stdout: string, stderr = ""): Outcome =>
  ok({ stdout, stderr });
