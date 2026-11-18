import {
  DEFAULT_TRANSCRIPT_PAGE_LINES,
  MAX_TRANSCRIPT_PAGE_CHARS,
  MAX_TRANSCRIPT_PAGE_LINES,
} from "@media-mcp/core";
import { describe, expect, it } from "vitest";
import { UNTRUSTED_GUIDANCE } from "../src/tools/untrusted.js";
import { withClient } from "./support/client.js";
import { fakeServices } from "./support/fake-services.js";

const listTools = () =>
  withClient(fakeServices(), async (client) => ({
    listed: (await client.listTools()).tools,
    instructions: client.getInstructions(),
  }));

const toolNamed = async (name: string) => {
  const { listed } = await listTools();
  const tool = listed.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`${name} is not listed`);
  return tool;
};

const EXPECTED_INPUTS = {
  get_transcripts: ["urls", "language", "timestamps", "maxItems", "startIndex"],
  get_video_info: ["urls", "maxItems", "startIndex", "includeDescription"],
  download_media: [
    "urls",
    "kind",
    "quality",
    "outputDir",
    "maxItems",
    "startIndex",
  ],
  read_transcript_file: ["path", "startLine", "maxLines"],
};

const URL_TOOLS = Object.keys(EXPECTED_INPUTS).filter(
  (name) => name !== "read_transcript_file",
);

const EXPECTED_ANNOTATIONS = {
  get_video_info: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  get_transcripts: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  download_media: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  read_transcript_file: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
};

describe("the listed tools", () => {
  it.each(Object.entries(EXPECTED_INPUTS))(
    "%s documents every input in order",
    async (name, inputs) => {
      const tool = await toolNamed(name);

      const properties = Object.entries(tool.inputSchema.properties ?? {});

      expect(properties.map(([property]) => property)).toEqual(inputs);
      for (const [, schema] of properties) {
        expect(schema).toMatchObject({
          description: expect.stringMatching(/\w/),
        });
      }
    },
  );

  it.each(Object.entries(EXPECTED_ANNOTATIONS))(
    "%s declares its behavior in annotations and a title",
    async (name, annotations) => {
      const tool = await toolNamed(name);

      expect(tool.annotations).toEqual(annotations);
      expect(tool.title).toMatch(/\w/);
    },
  );

  it.each(Object.keys(EXPECTED_INPUTS))(
    "%s keeps neutral wording and warns about untrusted text when it reads videos",
    async (name) => {
      const { description } = await toolNamed(name);

      expect(description).not.toMatch(/youtube/i);
      expect(description?.includes(UNTRUSTED_GUIDANCE)).toBe(
        name !== "download_media",
      );
    },
  );

  it("points download_media readers to the cheaper transcripts and warns that it takes minutes", async () => {
    const { description } = await toolNamed("download_media");

    expect(description).toMatch(/get_transcripts/);
    expect(description).toMatch(/take minutes/);
    expect(description).toMatch(/joins a download .* already running/);
  });

  it("describes the transcript behavior an agent depends on", async () => {
    const tool = await toolNamed("get_transcripts");

    expect(tool.description).toMatch(/timestamps are off by default/i);
    expect(tool.description).toMatch(/file path/i);
    expect(tool.description).toMatch(/without them fails with NO_CAPTIONS/);
    expect(tool.description).toMatch(/take minutes/);
    expect(tool.inputSchema.properties?.language).toMatchObject({
      description: expect.stringMatching(/match .* exactly/),
    });
  });

  it("explains how links are merged and expanded in every urls description", async () => {
    for (const name of URL_TOOLS) {
      const { inputSchema } = await toolNamed(name);

      expect(inputSchema.properties?.urls).toMatchObject({
        description: expect.stringMatching(
          /merged into one entry.*list parameter/s,
        ),
      });
    }
  });

  it("tells get_transcripts readers how to read a saved file, remotely or locally", async () => {
    const { description } = await toolNamed("get_transcripts");

    expect(description).toMatch(/read_transcript_file/);
    expect(description).toMatch(/stdio and HTTP/);
    expect(description).toMatch(/your own file tools/);
  });

  it("describes how read_transcript_file pages through a saved transcript", async () => {
    const tool = await toolNamed("read_transcript_file");

    expect(tool.description).toMatch(/get_transcripts/);
    expect(tool.description).toMatch(/exact filePath/);
    expect(tool.description).toMatch(/stdio and over HTTP/);
    expect(tool.description).toContain(
      `${DEFAULT_TRANSCRIPT_PAGE_LINES} lines by default`,
    );
    expect(tool.description).toContain(`${MAX_TRANSCRIPT_PAGE_LINES} lines`);
    expect(tool.description).toContain(
      `${MAX_TRANSCRIPT_PAGE_CHARS} characters`,
    );
    expect(tool.inputSchema.properties?.maxLines).toMatchObject({
      default: DEFAULT_TRANSCRIPT_PAGE_LINES,
      maximum: MAX_TRANSCRIPT_PAGE_LINES,
    });
    expect(tool.inputSchema.properties?.startLine).toMatchObject({
      default: 1,
      minimum: 1,
    });
  });

  it("tells the agent the workflow and the untrusted-text rule in the server instructions", async () => {
    const { instructions } = await listTools();

    const workflow = [
      "get_video_info",
      "get_transcripts",
      "download_media",
    ].map((name) => instructions?.indexOf(name) ?? -1);
    expect(workflow).not.toContain(-1);
    expect(workflow).toEqual(workflow.toSorted((a, b) => a - b));
    expect(instructions).toMatch(/file path/i);
    expect(instructions).toMatch(
      /read_transcript_file, which works over stdio and HTTP/,
    );
    expect(instructions).toMatch(
      /your own file tools when the server runs on your machine/,
    );
    expect(instructions?.includes(UNTRUSTED_GUIDANCE)).toBe(true);
  });
});
