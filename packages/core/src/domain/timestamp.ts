const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const PADDED_DIGITS = 2;

const twoDigits = (value: number): string =>
  String(value).padStart(PADDED_DIGITS, "0");

export const formatTimestamp = (totalSeconds: number): string => {
  const whole = Math.floor(totalSeconds);
  const hours = Math.floor(whole / (SECONDS_PER_MINUTE * MINUTES_PER_HOUR));
  const minutes = Math.floor(whole / SECONDS_PER_MINUTE) % MINUTES_PER_HOUR;
  const seconds = twoDigits(whole % SECONDS_PER_MINUTE);
  if (hours === 0) return `${minutes}:${seconds}`;
  return `${hours}:${twoDigits(minutes)}:${seconds}`;
};
