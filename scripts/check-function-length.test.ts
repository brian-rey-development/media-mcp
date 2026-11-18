import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_FUNCTION_LINES } from "./function-length.ts";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "check-function-length.ts",
);

const WORKSPACE_FILE = "packages:\n  - packages/*\n  - apps/*\n";
const DECLARATION_LINES = 2;

const longFunction = (name: string): string => {
  const body = Array.from(
    { length: MAX_FUNCTION_LINES },
    (_, index) => `  step${index}();`,
  );
  return `export const ${name} = () => {\n${body.join("\n")}\n};\n`;
};

describe("check-function-length", () => {
  let root = "";

  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const run = () =>
    spawnSync(process.execPath, [SCRIPT, root], { encoding: "utf8" });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "function-length-"));
    write("pnpm-workspace.yaml", WORKSPACE_FILE);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("passes and reports totals when every function fits", () => {
    write("apps/web/src/short.ts", "export const one = () => 1;\n");

    const result = run();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 functions in 1 files");
  });

  it("fails and names file, line and length of each offender", () => {
    write("packages/core/src/deep/long.ts", longFunction("tooLong"));

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `packages/core/src/deep/long.ts:1 tooLong is ${MAX_FUNCTION_LINES + DECLARATION_LINES} lines, the limit is ${MAX_FUNCTION_LINES}`,
    );
  });

  it("does not scan tests, declaration files or folders outside src", () => {
    write("apps/web/src/long.test.ts", longFunction("inTest"));
    write("apps/web/src/types.d.ts", longFunction("inDeclaration"));
    write("apps/web/test/long.ts", longFunction("inTestFolder"));

    const result = run();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("0 functions in 0 files");
  });

  it("scans a workspace folder named only in pnpm-workspace.yaml", () => {
    write("pnpm-workspace.yaml", "packages:\n  - services/*\n");
    write("services/api/src/long.ts", longFunction("inService"));

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("services/api/src/long.ts:1 inService");
  });

  it("skips workspace folders that do not exist", () => {
    write("pnpm-workspace.yaml", "packages:\n  - missing/*\n  - apps/*\n");
    write("apps/web/src/short.ts", "export const one = () => 1;\n");

    expect(run().stdout).toContain("1 functions in 1 files");
  });

  it("scans the scripts folder", () => {
    write("scripts/long.ts", longFunction("inScripts"));

    expect(run().stderr).toContain("scripts/long.ts:1 inScripts");
  });
});
