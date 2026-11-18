import type { VideoRef } from "../../domain/media.js";
import { canonicalVideoUrl } from "./urls.js";

export const PROVIDER_NAME = "youtube";

export const youtubeRef = (id: string): VideoRef => ({
  provider: PROVIDER_NAME,
  id,
  url: canonicalVideoUrl(id),
});
