import { describe, expect, it } from "vitest";
import {
  exceedingLimit,
  type FunctionLength,
  MAX_FUNCTION_LINES,
  measureFunctions,
} from "./function-length.ts";

const lines = (count: number): string =>
  Array.from({ length: count }, (_, index) => `  step${index}();`).join("\n");

const only = (source: string): FunctionLength => {
  const [first, ...rest] = measureFunctions("sample.ts", source);
  if (first === undefined || rest.length > 0) {
    throw new Error("expected exactly one function");
  }
  return first;
};

describe("measureFunctions", () => {
  it("counts a declaration from its signature to its closing brace", () => {
    const source = `function run() {\n${lines(3)}\n}\n`;

    expect(only(source)).toEqual({ name: "run", line: 1, length: 5 });
  });

  it("counts a one line arrow as one line", () => {
    expect(only("export const add = (a: number) => a + 1;\n")).toEqual({
      name: "add",
      line: 1,
      length: 1,
    });
  });

  it("counts a multi line arrow with an expression body", () => {
    const source = "const make = (a: number) =>\n  [\n    a,\n  ].length;\n";

    expect(only(source)).toEqual({ name: "make", line: 1, length: 4 });
  });

  it("includes nested functions in the outer function and lists them too", () => {
    const source = [
      "const outer = () => {",
      "  const inner = () => {",
      "    return 1;",
      "  };",
      "  return inner();",
      "};",
    ].join("\n");

    expect(measureFunctions("sample.ts", source)).toEqual([
      { name: "outer", line: 1, length: 6 },
      { name: "inner", line: 2, length: 3 },
    ]);
  });

  it("starts a method at its own line, including async", () => {
    const source = [
      "const tool = {",
      "  async execute(args: string) {",
      "    return args;",
      "  },",
      "};",
    ].join("\n");

    expect(only(source)).toEqual({ name: "execute", line: 2, length: 3 });
  });

  it("measures class methods and arrow properties", () => {
    const source = [
      "class Box {",
      "  open() {",
      "    return 1;",
      "  }",
      "  close = () => {",
      "    return 2;",
      "  };",
      "}",
    ].join("\n");

    expect(measureFunctions("sample.ts", source)).toEqual([
      { name: "open", line: 2, length: 3 },
      { name: "close", line: 5, length: 3 },
    ]);
  });

  it("counts blank lines and comments inside the body", () => {
    const source = "function run() {\n\n  // note\n\n}\n";

    expect(only(source).length).toBe(5);
  });

  it("parses typescript syntax", () => {
    const source =
      "export const pick = <T extends object>(value: T): T => {\n  return value;\n};\n";

    expect(only(source)).toEqual({ name: "pick", line: 1, length: 3 });
  });

  it("ignores declarations without a body", () => {
    const source =
      "declare function run(): void;\nfunction over(a: string): void;\nfunction over(a: number): void {}\n";

    expect(measureFunctions("sample.ts", source)).toEqual([
      { name: "over", line: 3, length: 1 },
    ]);
  });

  it("keeps line numbers right after multi byte characters", () => {
    const source = `const label = "café 😀";\n\nconst run = () => {\n  return 1;\n};\n`;

    expect(only(source)).toEqual({ name: "run", line: 3, length: 3 });
  });

  it("throws on source that does not parse", () => {
    expect(() => measureFunctions("broken.ts", "const = ;")).toThrow(
      /broken\.ts/,
    );
  });
});

describe("exceedingLimit", () => {
  it("keeps only functions longer than the maximum", () => {
    const found: FunctionLength[] = [
      { name: "fits", line: 1, length: MAX_FUNCTION_LINES },
      { name: "long", line: 9, length: MAX_FUNCTION_LINES + 1 },
    ];

    expect(exceedingLimit(found)).toEqual([found[1]]);
  });
});
