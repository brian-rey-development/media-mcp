import {
  type ArrowFunctionExpression,
  type BindingPattern,
  type Function as FunctionNode,
  type Program,
  type PropertyKey,
  parseSync,
  Visitor,
  type VisitorObject,
} from "oxc-parser";

export const MAX_FUNCTION_LINES = 20;

const ANONYMOUS = "<anonymous>";
const NEWLINE = "\n";

export interface FunctionLength {
  name: string;
  line: number;
  length: number;
}

type AnyFunction = FunctionNode | ArrowFunctionExpression;
type Candidate = { type: string } | null | undefined;

const isFunction = (node: Candidate): node is AnyFunction =>
  node?.type === "FunctionDeclaration" ||
  node?.type === "FunctionExpression" ||
  node?.type === "ArrowFunctionExpression";

const nameOf = (key: PropertyKey | BindingPattern): string =>
  key.type === "Identifier" || key.type === "PrivateIdentifier"
    ? key.name
    : ANONYMOUS;

const lineStartOffsets = (source: string): number[] => {
  const starts = [0];
  for (let at = source.indexOf(NEWLINE); at !== -1; ) {
    starts.push(at + 1);
    at = source.indexOf(NEWLINE, at + 1);
  }
  return starts;
};

const createLineLocator = (source: string) => {
  const starts = lineStartOffsets(source);
  return (offset: number): number => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((starts[middle] ?? 0) <= offset) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };
};

type Names = Map<AnyFunction, string>;

const remember = (names: Names, target: Candidate, label: string): void => {
  if (isFunction(target)) names.set(target, label);
};

const createVisitor = (
  names: Names,
  measure: (node: AnyFunction) => void,
): VisitorObject => ({
  VariableDeclarator: (node) => remember(names, node.init, nameOf(node.id)),
  PropertyDefinition: (node) => remember(names, node.value, nameOf(node.key)),
  MethodDefinition: (node) => remember(names, node.value, nameOf(node.key)),
  Property: (node) => remember(names, node.value, nameOf(node.key)),
  FunctionDeclaration: (node) => {
    remember(names, node, node.id?.name ?? ANONYMOUS);
    measure(node);
  },
  FunctionExpression: measure,
  ArrowFunctionExpression: measure,
});

const visitFunctions = (source: string, program: Program): FunctionLength[] => {
  const locate = createLineLocator(source);
  const names: Names = new Map();
  const found: FunctionLength[] = [];
  const measure = (node: AnyFunction): void => {
    if (node.body === null) return;
    const line = locate(node.start);
    const length = locate(node.end - 1) - line + 1;
    found.push({ name: names.get(node) ?? ANONYMOUS, line, length });
  };
  new Visitor(createVisitor(names, measure)).visit(program);
  return found;
};

export const measureFunctions = (
  fileName: string,
  source: string,
): FunctionLength[] => {
  const { program, errors } = parseSync(fileName, source);
  const [first] = errors;
  if (first !== undefined) throw new Error(`${fileName}: ${first.message}`);
  return visitFunctions(source, program);
};

export const exceedingLimit = (found: FunctionLength[]): FunctionLength[] =>
  found.filter(({ length }) => length > MAX_FUNCTION_LINES);
