import type { FileHandle } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";
import { excerptOf } from "./excerpt.js";

const CHUNK_BYTES = 64 * 1024;
const LINE_BREAK = "\n";
const CARRIAGE_RETURN = /\r$/;

export interface LineWindow {
  startLine: number;
  maxLines: number;
  maxChars: number;
}

export interface LinePage {
  lines: string[];
  totalLines: number;
}

interface Collecting extends LinePage {
  chars: number;
  full: boolean;
}

async function* chunksOf(handle: FileHandle, signal?: AbortSignal) {
  const buffer = Buffer.alloc(CHUNK_BYTES);
  for (;;) {
    signal?.throwIfAborted();
    const { bytesRead } = await handle.read(buffer, 0, CHUNK_BYTES, null);
    if (bytesRead === 0) return;
    yield buffer.subarray(0, bytesRead);
  }
}

// Only the first maxChars of a line are ever returned, so the rest of a very long line is dropped while it streams by.
async function* linesOf(
  handle: FileHandle,
  maxChars: number,
  signal?: AbortSignal,
) {
  const decoder = new StringDecoder("utf8");
  let partial = "";
  for await (const chunk of chunksOf(handle, signal)) {
    const pieces = (partial + decoder.write(chunk)).split(LINE_BREAK);
    partial = (pieces.pop() ?? "").slice(0, maxChars + 1);
    yield* pieces;
  }
  const rest = partial + decoder.end();
  if (rest !== "") yield rest;
}

const take = (page: Collecting, raw: string, window: LineWindow): void => {
  const line = excerptOf(raw.replace(CARRIAGE_RETURN, ""), window.maxChars);
  const cost = line.length + (page.lines.length > 0 ? LINE_BREAK.length : 0);
  if (
    page.lines.length >= window.maxLines ||
    page.chars + cost > window.maxChars
  ) {
    page.full = true;
    return;
  }
  page.lines.push(line);
  page.chars += cost;
};

export const readLinePage = async (
  handle: FileHandle,
  window: LineWindow,
  signal?: AbortSignal,
): Promise<LinePage> => {
  const page: Collecting = { lines: [], totalLines: 0, chars: 0, full: false };
  for await (const raw of linesOf(handle, window.maxChars, signal)) {
    page.totalLines += 1;
    if (page.totalLines >= window.startLine && !page.full)
      take(page, raw, window);
  }
  return { lines: page.lines, totalLines: page.totalLines };
};
