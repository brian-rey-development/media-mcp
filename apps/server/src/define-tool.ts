import type { Services } from "@media-mcp/core";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";

export interface ToolContext {
  services: Services;
  signal: AbortSignal;
  reportProgress(
    progress: number,
    total: number,
    message?: string,
  ): Promise<void>;
}

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: true;
};

const FAILURE: unique symbol = Symbol("tool failure");

export interface ToolFailure {
  readonly [FAILURE]: string;
}

export const toolFailure = (text: string): ToolFailure => ({ [FAILURE]: text });

const isFailure = (value: unknown): value is ToolFailure =>
  typeof value === "object" && value !== null && FAILURE in value;

type Input<I extends z.ZodRawShape> = z.infer<z.ZodObject<I>>;
type Output<O extends z.ZodRawShape> = z.infer<z.ZodObject<O>>;

interface ToolSpec<I extends z.ZodRawShape, O extends z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  annotations: ToolAnnotations;
  input: I;
  output: O;
  render: (output: Output<O>) => string;
  handler: (
    args: Input<I>,
    context: ToolContext,
  ) => Promise<Output<O> | ToolFailure>;
}

export type ToolDefinition<
  I extends z.ZodRawShape = z.ZodRawShape,
  O extends z.ZodRawShape = z.ZodRawShape,
> = Omit<ToolSpec<I, O>, "render" | "handler"> & {
  execute(args: Input<I>, context: ToolContext): Promise<ToolResult>;
};

export const defineTool = <I extends z.ZodRawShape, O extends z.ZodRawShape>({
  render,
  handler,
  ...definition
}: ToolSpec<I, O>): ToolDefinition<I, O> => ({
  ...definition,
  async execute(args, context) {
    const output = await handler(args, context);
    if (isFailure(output)) {
      return {
        content: [{ type: "text", text: output[FAILURE] }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: render(output) }],
      structuredContent: output,
    };
  },
});
