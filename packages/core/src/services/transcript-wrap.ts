const WRAP_COLUMNS = 100;

const splitLongWord = (word: string): string[] => {
  const points = Array.from(word);
  return Array.from(
    { length: Math.ceil(points.length / WRAP_COLUMNS) },
    (_, i) => points.slice(i * WRAP_COLUMNS, (i + 1) * WRAP_COLUMNS).join(""),
  );
};

const wrapLine = (line: string): string[] => {
  if (line.length <= WRAP_COLUMNS) return [line];
  const lines: string[] = [];
  for (const word of line.split(" ").filter((part) => part !== "")) {
    for (const piece of splitLongWord(word)) {
      const last = lines.at(-1);
      if (last !== undefined && last.length + 1 + piece.length <= WRAP_COLUMNS)
        lines[lines.length - 1] = `${last} ${piece}`;
      else lines.push(piece);
    }
  }
  return lines;
};

export const wrapForFile = (text: string): string =>
  text.split("\n").flatMap(wrapLine).join("\n");
