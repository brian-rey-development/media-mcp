import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SCRIPT = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const template = args[args.indexOf("-o") + 1];
const FIELDS = { title: "Title", id: "abc", ext: "mp4" };
const expandField = (_match, field) => {
  const [name, alternative] = field.split("|");
  return alternative ?? FIELDS[name] ?? "";
};
const expandVars = (text) => text.replace(/\\$(\\w+)/g, (_m, name) => process.env[name] ?? "");
const expanded = expandVars(
  template.replace(/%%/g, "\\u0000").replace(/%\\(([^)]*)\\)(?:\\.\\d+B|s)/g, expandField).replace(/\\u0000/g, "%"),
);
const target = path.resolve(process.cwd(), expanded);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, "video bytes");
console.log(expanded);
`;

export const writeFakeYtDlp = async (directory: string): Promise<string> => {
  const file = join(directory, "fake-yt-dlp");
  await writeFile(file, SCRIPT);
  await chmod(file, 0o755);
  return file;
};
