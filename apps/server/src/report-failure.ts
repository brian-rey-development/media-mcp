import { FAILURE_EXIT_CODE } from "./exit-codes.js";
import type { Logger } from "./logger.js";

interface ReportableError {
  message: string;
  hint?: string;
}

export const reportFailure = (
  logger: Logger,
  { message, hint }: ReportableError,
): void => {
  logger.error(message);
  if (hint) logger.error(`Hint: ${hint}`);
  process.exitCode = FAILURE_EXIT_CODE;
};
