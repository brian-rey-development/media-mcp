import type { VideoRef } from "../domain/media.js";
import { err, ok, type Result } from "../domain/result.js";
import { excerptOf } from "../infra/excerpt.js";
import { isHttpUrl } from "../infra/http-url.js";
import type {
  Provider,
  Resolved,
  ResolveOptions,
} from "../providers/provider.js";
import type { Registry } from "../providers/registry.js";
import { videoKey } from "./keys.js";
import type { Runtime } from "./runtime.js";
import {
  type BatchOutcome,
  type BatchRequest,
  failedEntry,
  type Truncation,
  type UrlEntry,
  withValue,
} from "./types.js";

export interface Target {
  provider: Provider;
  ref: VideoRef;
}

interface Expansion {
  entries: UrlEntry<Target>[];
  truncations: Truncation[];
}

const MAX_ECHOED_URL_CHARS = 200;
const TRUNCATION_MARK = "...";

const sourceNames = (registry: Registry): string =>
  registry.all.map((provider) => provider.name).join(", ");

const echoed = (url: string): string =>
  url.length > MAX_ECHOED_URL_CHARS
    ? `${excerptOf(url, MAX_ECHOED_URL_CHARS)}${TRUNCATION_MARK}`
    : url;

const providerFor = (url: string, registry: Registry): Result<Provider> => {
  if (!isHttpUrl(url)) {
    return err(
      "INVALID_URL",
      `"${echoed(url)}" is not an http or https link`,
      `Pass a full link from a supported source: ${sourceNames(registry)}`,
    );
  }
  const provider = registry.find(url);
  return provider
    ? ok(provider)
    : err(
        "UNSUPPORTED_URL",
        `No supported source matches "${echoed(url)}"`,
        `Supported sources: ${sourceNames(registry)}`,
      );
};

export const videoCount = ({ entries }: Expansion): number =>
  entries.filter((entry) => entry.ok).length;

const isPlanned = (plan: Expansion, target: Target): boolean =>
  plan.entries.some(
    (entry) => entry.ok && videoKey(entry.value.ref) === videoKey(target.ref),
  );

const uniqueTargets = (targets: Target[]): Target[] => [
  ...new Map(targets.map((target) => [videoKey(target.ref), target])).values(),
];

const takeFrom = (
  plan: Expansion,
  provider: Provider,
  refs: readonly VideoRef[],
  maxItems: number,
): { taken: Target[]; included: number } => {
  const fresh = uniqueTargets(refs.map((ref) => ({ provider, ref }))).filter(
    (target) => !isPlanned(plan, target),
  );
  const taken = fresh.slice(0, Math.max(maxItems - videoCount(plan), 0));
  return { taken, included: refs.length - (fresh.length - taken.length) };
};

const withFailure = (
  plan: Expansion,
  url: string,
  failure: Result<never>,
): Expansion => ({
  ...plan,
  entries: [...plan.entries, failedEntry(url, failure)],
});

const withSkipped = (plan: Expansion, source: string): Expansion => ({
  ...plan,
  truncations: [
    ...plan.truncations,
    { source, included: 0, totalExact: false },
  ],
});

const truncationOf = (
  source: string,
  { refs, total, totalExact }: Resolved,
  included: number,
  startIndex: number,
): Truncation | undefined => {
  if (refs.length === 0) return { source, total, totalExact, included };
  if (total <= startIndex - 1 + included) return undefined;
  return {
    source,
    total,
    totalExact,
    included,
    nextStartIndex: startIndex + included,
  };
};

const plannedEntry =
  (source: string) =>
  (target: Target): UrlEntry<Target> =>
    withValue({ url: target.ref.url, inputUrl: source }, ok(target));

const withSource = (
  plan: Expansion,
  provider: Provider,
  source: string,
  resolved: Resolved,
  { maxItems, startIndex }: ResolveOptions,
): Expansion => {
  const { taken, included } = takeFrom(plan, provider, resolved.refs, maxItems);
  const cut = truncationOf(source, resolved, included, startIndex);
  return {
    entries: [...plan.entries, ...taken.map(plannedEntry(source))],
    truncations: cut ? [...plan.truncations, cut] : plan.truncations,
  };
};

const resolveSource = (
  { resolutions }: Runtime,
  provider: Provider,
  url: string,
  { maxItems, startIndex }: ResolveOptions,
  signal?: AbortSignal,
): Promise<Result<Resolved>> =>
  resolutions(
    `${url}|${startIndex}|${maxItems}`,
    () => provider.resolve(url, { maxItems, startIndex }, signal),
    signal,
  );

const expandSource = async (
  runtime: Runtime,
  plan: Expansion,
  provider: Provider,
  url: string,
  bounds: ResolveOptions,
  signal?: AbortSignal,
): Promise<Expansion> => {
  const resolved = await resolveSource(runtime, provider, url, bounds, signal);
  return resolved.ok
    ? withSource(plan, provider, url, resolved.value, bounds)
    : withFailure(plan, url, resolved);
};

const addSource = async (
  runtime: Runtime,
  plan: Expansion,
  url: string,
  bounds: ResolveOptions,
  signal?: AbortSignal,
): Promise<Expansion> => {
  const provider = providerFor(url, runtime.registry);
  if (!provider.ok) return withFailure(plan, url, provider);
  if (videoCount(plan) >= bounds.maxItems) return withSkipped(plan, url);
  return expandSource(runtime, plan, provider.value, url, bounds, signal);
};

const uniqueUrls = (urls: readonly string[]): string[] => [...new Set(urls)];

export const failEveryUrl = (
  urls: readonly string[],
  failure: Result<never>,
): BatchOutcome<never> => ({
  entries: uniqueUrls(urls).map((url) => failedEntry(url, failure)),
  truncations: [],
});

export const expandUrls = async (
  runtime: Runtime,
  request: BatchRequest,
  signal?: AbortSignal,
): Promise<Expansion> => {
  let plan: Expansion = { entries: [], truncations: [] };
  for (const url of uniqueUrls(request.urls)) {
    plan = await addSource(runtime, plan, url, request, signal);
  }
  return plan;
};
