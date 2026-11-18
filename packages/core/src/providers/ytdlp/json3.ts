import { z } from "zod";
import { err, ok, type Result } from "../../domain/result.js";
import { formatTimestamp } from "../../domain/timestamp.js";
import { MS_PER_SECOND } from "../../infra/units.js";
import { RETRY_HINT } from "./hints.js";

const ZERO_WIDTH_CHARACTERS = /[\u200B-\u200F\u2060\uFEFF]/g;
const BRACKETED_CUE = /\[[^\]]*\]/g;
const WHOLE_CUE = /^\[[^\]]*\]$/;

const EventSchema = z.object({
  tStartMs: z.number().default(0),
  dDurationMs: z.number().optional(),
  segs: z.array(z.object({ utf8: z.string().optional() })).optional(),
});

const DocumentSchema = z.object({ events: z.array(z.unknown()) });

interface CaptionEvent {
  startMs: number;
  endMs: number | undefined;
  lines: string[];
}

interface CaptionLine {
  startMs: number;
  text: string;
}

export interface ParsedCaptions {
  text: string;
  wordCount: number;
}

const cleanLine = (line: string): string =>
  line
    .replace(ZERO_WIDTH_CHARACTERS, "")
    .replace(/\s+/g, " ")
    .trim()
    .toWellFormed();

const toEvent = (raw: unknown): CaptionEvent | undefined => {
  const parsed = EventSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const { tStartMs, dDurationMs, segs = [] } = parsed.data;
  const lines = segs
    .map((seg) => seg.utf8 ?? "")
    .join("")
    .split("\n")
    .map(cleanLine)
    .filter((text) => text !== "");
  const endMs = dDurationMs === undefined ? undefined : tStartMs + dDurationMs;
  return { startMs: tStartMs, endMs, lines };
};

const overlapLength = (previous: string[], next: string[]): number => {
  const limit = Math.min(previous.length, next.length);
  const candidates = Array.from({ length: limit }, (_, index) => limit - index);
  return (
    candidates.find((size) =>
      previous.slice(-size).every((line, index) => line === next[index]),
    ) ?? 0
  );
};

const isRollingOver = (previous: CaptionEvent, next: CaptionEvent): boolean =>
  previous.endMs !== undefined && next.startMs < previous.endMs;

const withoutRollingRepeats = (events: CaptionEvent[]): CaptionLine[] => {
  let previous: CaptionEvent | undefined;
  const lines: CaptionLine[] = [];
  for (const event of events) {
    const repeated =
      previous && isRollingOver(previous, event)
        ? overlapLength(previous.lines, event.lines)
        : 0;
    for (const text of event.lines.slice(repeated))
      lines.push({ startMs: event.startMs, text });
    if (event.lines.length > 0) previous = event;
  }
  return lines;
};

const withoutRepeatedCues = (lines: CaptionLine[]): CaptionLine[] =>
  lines.filter(
    (line, index) =>
      !(WHOLE_CUE.test(line.text) && line.text === lines[index - 1]?.text),
  );

const timestampedLine = ({ startMs, text }: CaptionLine): string =>
  `[${formatTimestamp(startMs / MS_PER_SECOND)}] ${text}`;

const countWords = (lines: CaptionLine[]): number =>
  lines.reduce(
    (total, { text }) =>
      total +
      text.replace(BRACKETED_CUE, " ").split(" ").filter(Boolean).length,
    0,
  );

const parseDocument = (raw: string): unknown[] | undefined => {
  try {
    const parsed = DocumentSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.events : undefined;
  } catch {
    return undefined;
  }
};

const unusable = (): Result<never> =>
  err(
    "PARSE_FAILED",
    "The caption file is not in the expected json3 format",
    RETRY_HINT,
  );

export const parseJson3 = (
  raw: string,
  options: { timestamps: boolean },
): Result<ParsedCaptions> => {
  const rawEvents = parseDocument(raw);
  if (!rawEvents) return unusable();
  const events = rawEvents.flatMap((event) => toEvent(event) ?? []);
  if (rawEvents.length > 0 && events.length === 0) return unusable();
  const lines = withoutRepeatedCues(withoutRollingRepeats(events));
  const text = options.timestamps
    ? lines.map(timestampedLine).join("\n")
    : lines.map((line) => line.text).join(" ");
  return ok({ text, wordCount: countWords(lines) });
};
