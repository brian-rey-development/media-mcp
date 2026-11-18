import type { Clock } from "../../src/infra/clock.js";

interface ClockState {
  time: number;
  slept: number[];
}

export const fakeClock = (until: Promise<void> = Promise.resolve()) => {
  const state: ClockState = { time: 0, slept: [] };
  const clock: Clock = {
    now: () => state.time,
    sleep: async (ms) => {
      state.slept.push(ms);
      await until;
      state.time += ms;
    },
  };
  return { clock, state };
};
