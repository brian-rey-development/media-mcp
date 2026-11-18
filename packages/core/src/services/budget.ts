interface Costed {
  size: number;
  overflowCost: number;
}

type Budgeted<T> = T & { fits: boolean };

interface Running<T> {
  used: number;
  items: Budgeted<T>[];
}

const decide = <T extends Costed>(
  { used, items }: Running<T>,
  item: T,
  budget: number,
): Running<T> => {
  const fits = used + item.size <= budget;
  const cost = fits ? item.size : item.overflowCost;
  return { used: used + cost, items: [...items, { ...item, fits }] };
};

export const applyBudget = <T extends Costed>(
  items: readonly T[],
  budget: number,
): Budgeted<T>[] =>
  items.reduce<Running<T>>((running, item) => decide(running, item, budget), {
    used: 0,
    items: [],
  }).items;
