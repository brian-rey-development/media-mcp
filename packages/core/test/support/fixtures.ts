import { readFile } from "node:fs/promises";

export const readFixture = (name: string): Promise<string> =>
  readFile(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
