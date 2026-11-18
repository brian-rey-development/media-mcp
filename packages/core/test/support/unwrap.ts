import type { MediaError } from "../../src/domain/errors.js";
import type { Result } from "../../src/domain/result.js";

export const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) {
    throw new Error(
      `Expected ok but got ${result.error.code}: ${result.error.message}`,
    );
  }
  return result.value;
};

export const unwrapError = <T>(result: Result<T>): MediaError => {
  if (result.ok) throw new Error("Expected an error but got ok");
  return result.error;
};
