#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { captionFilesFor } from "../../../../packages/core/test/support/caption-emulation.ts";
import { FAKE_YTDLP_VERSION } from "../support/process-env.ts";

// Switches, all read from this process's own environment (none starts with
// MEDIA_MCP_, because the server strips that prefix from every child).
//   FAKE_YTDLP_VERSION_OVERRIDE  the version --version prints
//   FAKE_YTDLP_ENV_FILE          write this process's environment there as JSON
//   FAKE_YTDLP_PID_FILE          write this process id there before a held call
//   FAKE_YTDLP_HOLD_MS           sleep this long before answering a metadata call
//   FAKE_YTDLP_IGNORE_SIGTERM    swallow SIGTERM, so only a SIGKILL ends the process
//   FAKE_YTDLP_ERROR_CHARS       fail every metadata call with an error this long
const FIXTURES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/core/test/fixtures",
);
const UNAVAILABLE_ID = "unavailabl1";
const args = process.argv.slice(2);
const url = args.at(-1) ?? "";
const videoId =
  new URL(url, "https://unused.example/").searchParams.get("v") ?? "unknown";

const has = (flag) => args.includes(flag);
const after = (flag) => args[args.indexOf(flag) + 1];
const fixture = (name) => readFileSync(resolve(FIXTURES, name), "utf8");
const fail = (message) => {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
};

const writeCaptions = () => {
  const info = JSON.parse(fixture("sintel.info.json"));
  for (const { name, source } of captionFilesFor(args, info)) {
    writeFileSync(
      name,
      fixture(source === "manual" ? "sintel.en.json3" : "sintel.auto.en.json3"),
    );
  }
};

const download = () => {
  const name = `Sintel [${videoId}] ${has("-x") ? "audio" : "1080p"}.${has("-x") ? "m4a" : "mp4"}`;
  writeFileSync(resolve(process.cwd(), name), "fake media bytes");
  for (const percent of ["50.0", "100.0"]) console.log(`download:${percent}%`);
  console.log(name);
};

const holdIfAsked = async () => {
  if (process.env.FAKE_YTDLP_IGNORE_SIGTERM) process.on("SIGTERM", () => {});
  const { FAKE_YTDLP_PID_FILE: pidFile, FAKE_YTDLP_HOLD_MS: holdMs } =
    process.env;
  if (pidFile) writeFileSync(pidFile, String(process.pid));
  if (holdMs) await sleep(Number(holdMs));
};

const failIfAsked = () => {
  const chars = Number(process.env.FAKE_YTDLP_ERROR_CHARS ?? 0);
  if (chars > 0) fail(`[youtube] ${videoId}: ${"x".repeat(chars)}`);
};

const metadata = async () => {
  await holdIfAsked();
  failIfAsked();
  writeCaptions();
  if (has("--print")) process.stdout.write(fixture("sintel.info.json"));
};

if (process.env.FAKE_YTDLP_ENV_FILE) {
  writeFileSync(process.env.FAKE_YTDLP_ENV_FILE, JSON.stringify(process.env));
}

if (has("--version")) {
  console.log(process.env.FAKE_YTDLP_VERSION_OVERRIDE ?? FAKE_YTDLP_VERSION);
} else if (videoId === UNAVAILABLE_ID) {
  fail(`[youtube] ${videoId}: Video unavailable`);
} else if (has("--flat-playlist")) {
  process.stdout.write(fixture("playlist.flat.json"));
} else if (has("--skip-download")) {
  await metadata();
} else if (after("--print") === "after_move:filepath") {
  download();
} else if (has("--print")) {
  failIfAsked();
  process.stdout.write(fixture("sintel.info.json"));
} else {
  fail(`fake-yt-dlp does not understand ${args.join(" ")}`);
}
