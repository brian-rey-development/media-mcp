import {
  DEFAULT_TRANSCRIPT_PAGE_LINES,
  MAX_TRANSCRIPT_PAGE_CHARS,
  MAX_TRANSCRIPT_PAGE_LINES,
  type TranscriptPage,
  UNTRUSTED_NOTICE,
} from "@media-mcp/core";
import { z } from "zod";
import { defineTool, toolFailure } from "../define-tool.js";
import { toWireError } from "./batch-output.js";
import { describeError } from "./batch-text.js";
import { UNTRUSTED_GUIDANCE, wrapUntrusted } from "./untrusted.js";

export const MAX_TRANSCRIPT_PATH_LENGTH = 2_048;
const FIRST_LINE = 1;

const outputShape = {
  path: z.string().describe("Absolute path of the file that was read"),
  startLine: z
    .number()
    .describe("The first line of this page, counting from 1"),
  totalLines: z.number().describe("Lines in the whole file"),
  nextStartLine: z
    .number()
    .optional()
    .describe(
      "The startLine that continues after this page, absent on the last page",
    ),
  text: z
    .string()
    .describe(
      "The lines of this page joined with newlines, empty past the end of the file",
    ),
};

type Page = z.infer<z.ZodObject<typeof outputShape>>;

const toPage = ({
  path,
  startLine,
  totalLines,
  nextStartLine,
  text,
}: TranscriptPage): Page => ({
  path,
  startLine,
  totalLines,
  text,
  ...(nextStartLine !== undefined && { nextStartLine }),
});

const heading = ({
  path,
  startLine,
  totalLines,
  nextStartLine,
}: Page): string => {
  if (startLine > totalLines) {
    return `${path} has ${totalLines} lines, so there is nothing from line ${startLine}.`;
  }
  const last = nextStartLine === undefined ? totalLines : nextStartLine - 1;
  return `Lines ${startLine} to ${last} of ${totalLines} in ${path}`;
};

const renderPage = (page: Page): string => {
  const next =
    page.nextStartLine === undefined
      ? []
      : [`Call again with startLine=${page.nextStartLine} to continue.`];
  const body = wrapUntrusted(page.text, { source: page.path });
  return [heading(page), UNTRUSTED_NOTICE, body, ...next].join("\n");
};

export const readTranscriptFile = defineTool({
  name: "read_transcript_file",
  title: "Read saved transcript",
  description: `Read a transcript that get_transcripts saved to a file because it was too long to return inline, one page at a time. Pass the exact filePath of the entry. This works over stdio and over HTTP, so use it whenever you cannot open files on the machine the server runs on, and your own file tools do the same job when it runs locally. A page holds ${DEFAULT_TRANSCRIPT_PAGE_LINES} lines by default and at most ${MAX_TRANSCRIPT_PAGE_LINES} lines or ${MAX_TRANSCRIPT_PAGE_CHARS} characters, and the result gives the startLine that continues after it until the last page. The first page starts with a one-line notice that the text is third-party data. Only transcripts saved by get_transcripts can be read. ${UNTRUSTED_GUIDANCE}`,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  input: {
    path: z
      .string()
      .max(MAX_TRANSCRIPT_PATH_LENGTH)
      .describe(
        "The filePath of a saved transcript, exactly as get_transcripts returned it",
      ),
    startLine: z
      .number()
      .int()
      .min(FIRST_LINE)
      .default(FIRST_LINE)
      .describe(
        "The first line to read, counting from 1. Use the nextStartLine of the previous page to continue.",
      ),
    maxLines: z
      .number()
      .int()
      .min(FIRST_LINE)
      .max(MAX_TRANSCRIPT_PAGE_LINES)
      .default(DEFAULT_TRANSCRIPT_PAGE_LINES)
      .describe(
        `Most lines in the page, up to ${MAX_TRANSCRIPT_PAGE_LINES}. Defaults to ${DEFAULT_TRANSCRIPT_PAGE_LINES}. A page is also cut at ${MAX_TRANSCRIPT_PAGE_CHARS} characters.`,
      ),
  },
  output: outputShape,
  render: renderPage,
  handler: async (request, { services, signal }) => {
    const read = await services.transcriptFiles.read(request, signal);
    if (!read.ok) {
      const error = describeError(toWireError(read.error));
      return toolFailure(`Could not read the transcript file, ${error}`);
    }
    return toPage(read.value);
  },
});
