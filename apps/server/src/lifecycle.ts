export interface Lifecycle {
  signal: AbortSignal;
  track<T>(work: Promise<T>): Promise<T>;
  abort(): void;
  settled(): Promise<void>;
}

export const createLifecycle = (): Lifecycle => {
  const controller = new AbortController();
  const pending = new Set<Promise<unknown>>();
  const forget = (work: Promise<unknown>) => () => {
    pending.delete(work);
  };
  return {
    signal: controller.signal,
    abort: () => controller.abort(),
    track: (work) => {
      pending.add(work);
      work.then(forget(work), forget(work));
      return work;
    },
    settled: async () => {
      await Promise.allSettled([...pending]);
    },
  };
};
