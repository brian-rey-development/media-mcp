import type {
  BatchOutput,
  FailedEntry,
  TruncationEntry,
} from "./batch-output.js";
import { quoted } from "./untrusted.js";

const SECTION_SEPARATOR = "\n\n";

export const describeError = ({
  code,
  message,
  hint,
}: FailedEntry["error"]): string =>
  `${code}, ${quoted(message)}${hint ? `\n${hint}` : ""}`;

const renderFailure = ({ url, error }: FailedEntry): string =>
  `Failed ${url} with ${describeError(error)}`;

const renderTruncation = ({
  source,
  total,
  included,
  totalExact,
  nextStartIndex,
}: TruncationEntry): string => {
  if (total === undefined) {
    return `${source} was left out because maxItems was reached. Call again with this link on its own.`;
  }
  const count = totalExact ? `${total}` : `at least ${total}`;
  const next =
    nextStartIndex === undefined
      ? ""
      : ` Call again with startIndex=${nextStartIndex} to continue.`;
  return `${source} has ${count} videos, only ${included} were included.${next}`;
};

export const renderBatch = <Success extends { ok: true }>(
  output: BatchOutput<Success>,
  renderSuccess: (entry: Success) => string,
  separator = SECTION_SEPARATOR,
): string =>
  [
    ...output.entries.map((entry) =>
      entry.ok ? renderSuccess(entry) : renderFailure(entry),
    ),
    ...output.truncations.map(renderTruncation),
  ].join(separator);
