import { fileURLToPath } from "node:url";
import { build } from "tsdown";

const SERVER_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export async function setup(): Promise<void> {
  await build({ cwd: SERVER_ROOT, logLevel: "silent" });
}
