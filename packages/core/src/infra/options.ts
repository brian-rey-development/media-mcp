type Defined<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<
    T[K],
    undefined
  >;
};

// Object.fromEntries widens to a string-keyed record, the filter is what makes the mapped type true.
export const omitUndefined = <T extends object>(value: T): Defined<T> =>
  Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Defined<T>;

export type Loose<T> = { [K in keyof T]?: T[K] | undefined };
