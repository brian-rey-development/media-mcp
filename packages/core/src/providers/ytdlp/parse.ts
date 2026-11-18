import { z } from "zod";
import { err, ok, type Result } from "../../domain/result.js";
import { OUTPUT_CHANGED_HINT } from "./hints.js";

const describeParseError = (error: unknown): string =>
  error instanceof z.ZodError
    ? `unexpected value at ${error.issues[0]?.path.join(".") || "the top level"}`
    : "the output is not valid JSON";

export const printTemplate = (schema: z.ZodObject): string =>
  `%(.{${Object.keys(schema.shape).join(",")}})j`;

export const parseYtDlpJson = <Schema extends z.ZodType>(
  schema: Schema,
  stdout: string,
): Result<z.output<Schema>> => {
  try {
    return ok(schema.parse(JSON.parse(stdout)));
  } catch (error) {
    return err(
      "PARSE_FAILED",
      `yt-dlp returned output that could not be understood (${describeParseError(error)})`,
      OUTPUT_CHANGED_HINT,
    );
  }
};
