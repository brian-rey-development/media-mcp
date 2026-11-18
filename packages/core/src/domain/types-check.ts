import type { z } from "zod";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// A schema compiles here only when its output type is exactly T, so a schema and the type it mirrors cannot drift apart.
export const describes =
  <T>() =>
  <S extends z.ZodType>(
    schema: Same<z.output<S>, T> extends true ? S : never,
  ): S =>
    schema;
