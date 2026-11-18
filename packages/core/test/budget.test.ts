import { describe, expect, it } from "vitest";
import { applyBudget } from "../src/services/budget.js";

const item = (size: number, overflowCost = 0) => ({ size, overflowCost });
const modesOf = (
  items: { size: number; overflowCost: number }[],
  budget: number,
) => applyBudget(items, budget).map(({ fits }) => (fits ? "inline" : "file"));

describe("applyBudget", () => {
  it("keeps items inline while the running total fits, exactly up to the budget", () => {
    expect(modesOf([item(400), item(600)], 1_000)).toEqual([
      "inline",
      "inline",
    ]);
  });

  it("sends an item that would pass the budget one character over to a file", () => {
    expect(modesOf([item(400), item(601)], 1_000)).toEqual(["inline", "file"]);
  });

  it("sends an item larger than the whole budget to a file even when first", () => {
    expect(modesOf([item(1_001)], 1_000)).toEqual(["file"]);
  });

  it("does not charge the text of a file item, so later small items stay inline", () => {
    expect(modesOf([item(30), item(30), item(5)], 40)).toEqual([
      "inline",
      "file",
      "inline",
    ]);
  });

  it("charges each file item for its preview and header", () => {
    expect(modesOf([item(100, 8), item(100, 8), item(5)], 21)).toEqual([
      "file",
      "file",
      "inline",
    ]);
    expect(modesOf([item(100, 8), item(100, 8), item(5)], 20)).toEqual([
      "file",
      "file",
      "file",
    ]);
  });

  it("returns the original fields next to the mode, without mutating the input", () => {
    const items = [{ size: 5, overflowCost: 1, label: "a" }];

    const decided = applyBudget(items, 10);

    expect(decided).toEqual([
      { size: 5, overflowCost: 1, label: "a", fits: true },
    ]);
    expect(items).toEqual([{ size: 5, overflowCost: 1, label: "a" }]);
  });

  it("returns nothing for no items", () => {
    expect(applyBudget([], 10)).toEqual([]);
  });
});
