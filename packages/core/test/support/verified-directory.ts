import type { VerifiedDirectory } from "../../src/domain/media.js";
import { createDirectoryVerifier } from "../../src/infra/paths.js";
import { unwrap } from "./unwrap.js";

export const verified = async (directory: string): Promise<VerifiedDirectory> =>
  unwrap(await createDirectoryVerifier(directory, undefined)());
