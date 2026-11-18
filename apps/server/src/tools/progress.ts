import { type VideoRef, videoKey } from "@media-mcp/core";
import type { ToolContext } from "../define-tool.js";

const MIN_INTERVAL_MS = 250;
const PERCENT_COMPLETE = 100;

type Report = ToolContext["reportProgress"];
type Now = () => number;

const createSender = (report: Report, now: Now) => {
  const last = { progress: -1, at: Number.NEGATIVE_INFINITY };
  return (progress: number, total: number, message: string, force = false) => {
    const moved = progress > last.progress;
    const due = now() - last.at >= MIN_INTERVAL_MS;
    if (!moved || (!force && !due)) return;
    last.progress = progress;
    last.at = now();
    void report(progress, total, message);
  };
};

export const createCountProgress = (report: Report, now: Now = Date.now) => {
  const send = createSender(report, now);
  const state = { total: 0, done: 0 };
  return {
    plan: (total: number): void => {
      state.total = total;
    },
    itemDone: (ref: VideoRef): void => {
      state.done += 1;
      const finished = state.done >= state.total;
      send(state.done, state.total, `Fetched ${ref.id}`, finished);
    },
  };
};

const createDownloadState = () => {
  const percents = new Map<string, number>();
  const state = { total: 0 };
  return {
    plan: (count: number): void => {
      state.total = count * PERCENT_COMPLETE;
    },
    total: (): number => state.total,
    observe: (ref: VideoRef, percent: number) => {
      const best = Math.max(percents.get(videoKey(ref)) ?? 0, percent);
      percents.set(videoKey(ref), best);
      const sum = [...percents.values()].reduce((a, b) => a + b, 0);
      const progress = Math.min(Math.floor(sum), state.total - 1);
      return { best, progress, total: state.total };
    },
  };
};

export const createDownloadProgress = (report: Report, now: Now = Date.now) => {
  const send = createSender(report, now);
  const state = createDownloadState();
  return {
    plan: state.plan,
    update: (ref: VideoRef, percent: number): void => {
      const { best, progress, total } = state.observe(ref, percent);
      send(progress, total, `Downloading ${ref.id}, ${Math.floor(best)}%`);
    },
    finish: (): void => {
      const total = state.total();
      if (total > 0) send(total, total, "Finished downloading", true);
    },
  };
};
