import { createHash, timingSafeEqual } from "node:crypto";

const BEARER_CREDENTIALS = /^Bearer (.+)$/i;

const digestOf = (value: string): Buffer =>
  createHash("sha256").update(value).digest();

export const createTokenCheck = (token: string) => {
  const expected = digestOf(token);
  return (authorization: string | undefined): boolean => {
    const presented = BEARER_CREDENTIALS.exec(authorization ?? "")?.[1] ?? "";
    return timingSafeEqual(digestOf(presented), expected);
  };
};
