import { join } from "node:path";

export const platformCacheBase = (
  platform: NodeJS.Platform,
  home: string,
  env: NodeJS.ProcessEnv,
): string => {
  if (platform === "darwin") return join(home, "Library", "Caches");
  if (platform === "win32")
    return env.LOCALAPPDATA ?? join(home, "AppData", "Local");
  return env.XDG_CACHE_HOME ?? join(home, ".cache");
};
