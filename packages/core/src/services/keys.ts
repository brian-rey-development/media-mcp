import type { VideoRef } from "../domain/media.js";

export const videoKey = ({ provider, id }: VideoRef): string =>
  `${provider}:${id}`;

export const formatOf = (timestamps: boolean): "timestamps" | "plain" =>
  timestamps ? "timestamps" : "plain";
