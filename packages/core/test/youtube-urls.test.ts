import { describe, expect, it } from "vitest";
import {
  canonicalPlaylistUrl,
  parseYoutubeUrl,
  videoUrlOf,
} from "../src/providers/youtube/urls.js";

const ID = "jNQXAC9IWRw";
const VIDEO = { ok: true, value: { kind: "video", id: ID } };

describe("parseYoutubeUrl videos", () => {
  it.each([
    ["watch URL", `https://www.youtube.com/watch?v=${ID}`],
    ["bare host", `https://youtube.com/watch?v=${ID}`],
    ["watch with a trailing slash", `https://www.youtube.com/watch/?v=${ID}`],
    ["short link", `https://youtu.be/${ID}`],
    ["shorts", `https://www.youtube.com/shorts/${ID}`],
    ["embed", `https://www.youtube.com/embed/${ID}`],
    ["live", `https://www.youtube.com/live/${ID}`],
    ["old style v path", `https://www.youtube.com/v/${ID}`],
    ["privacy enhanced embed", `https://www.youtube-nocookie.com/embed/${ID}`],
    ["bare privacy enhanced host", `https://youtube-nocookie.com/embed/${ID}`],
    ["mobile host", `https://m.youtube.com/watch?v=${ID}`],
    ["music host", `https://music.youtube.com/watch?v=${ID}`],
    ["plain http", `http://www.youtube.com/watch?v=${ID}`],
    [
      "extra time and list params",
      `https://www.youtube.com/watch?v=${ID}&t=30s&list=PLx`,
    ],
    ["short link with a list", `https://youtu.be/${ID}?list=PLx`],
  ])("parses a %s to the same video", (_label, url) => {
    expect(parseYoutubeUrl(url)).toEqual(VIDEO);
  });

  it.each([
    ["userinfo", `https://someone:secret@www.youtube.com/watch?v=${ID}`],
    ["an uppercase host and scheme", `HTTPS://WWW.YOUTUBE.COM/watch?v=${ID}`],
    ["an explicit port", `https://www.youtube.com:8443/watch?v=${ID}`],
    ["a trailing dot in the host", `https://www.youtube.com./watch?v=${ID}`],
  ])("parses a link with %s to the same video", (_label, url) => {
    expect(parseYoutubeUrl(url)).toEqual(VIDEO);
  });
});

describe("parseYoutubeUrl playlists", () => {
  it("parses a playlist URL to a playlist target", () => {
    expect(
      parseYoutubeUrl("https://www.youtube.com/playlist?list=PLx"),
    ).toEqual({
      ok: true,
      value: { kind: "playlist", id: "PLx" },
    });
  });

  it("treats a watch URL with a list and no video as the playlist", () => {
    expect(parseYoutubeUrl("https://www.youtube.com/watch?list=PLx")).toEqual({
      ok: true,
      value: { kind: "playlist", id: "PLx" },
    });
  });

  it("accepts a playlist id of the maximum length and rejects a longer one", () => {
    const longest = "P".repeat(64);

    expect(
      parseYoutubeUrl(`https://www.youtube.com/playlist?list=${longest}`),
    ).toMatchObject({ ok: true });
    expect(
      parseYoutubeUrl(`https://www.youtube.com/playlist?list=${longest}P`),
    ).toMatchObject({ ok: false, error: { code: "INVALID_URL" } });
  });
});

describe("parseYoutubeUrl rejections", () => {
  it.each([
    ["a non-http scheme", "ftp://youtube.com/x"],
    ["an injected exec option", "--exec=touch /tmp/x"],
    ["an injected output option", "-o /etc/x"],
    ["an empty string", ""],
    ["a video id with illegal characters", "https://youtu.be/abc$%^&*(!@#"],
    ["a video id of the wrong length", "https://youtu.be/short"],
    ["a watch URL without an id or list", "https://www.youtube.com/watch"],
    ["a playlist URL without a list", "https://www.youtube.com/playlist"],
    [
      "an embedded playlist",
      "https://www.youtube.com/embed/videoseries?list=PLx",
    ],
    [
      "an embedded playlist without a list",
      "https://www.youtube.com/embed/videoseries",
    ],
    [
      "an embed carrying a list",
      `https://www.youtube.com/embed/${ID}?list=PLx`,
    ],
    [
      "a privacy enhanced embedded playlist",
      "https://www.youtube-nocookie.com/embed/videoseries?list=PLx",
    ],
  ])("rejects %s as INVALID_URL", (_label, url) => {
    expect(parseYoutubeUrl(url)).toMatchObject({
      ok: false,
      error: { code: "INVALID_URL" },
    });
  });

  it.each([
    ["another site", "https://vimeo.com/123456"],
    ["a lookalike host", `https://evil.com/watch?v=${ID}`],
    [
      "a host hidden in userinfo",
      `https://www.youtube.com@evil.com/watch?v=${ID}`,
    ],
    ["a YouTube channel page", "https://www.youtube.com/@BlenderOfficial"],
  ])("rejects %s as UNSUPPORTED_URL", (_label, url) => {
    expect(parseYoutubeUrl(url)).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_URL" },
    });
  });
});

describe("videoUrlOf", () => {
  it("builds the canonical watch URL from a valid video id", () => {
    expect(videoUrlOf(ID)).toEqual({
      ok: true,
      value: `https://www.youtube.com/watch?v=${ID}`,
    });
  });

  it.each([
    "PLa1F2ddGya_84ye1JAvIGh0Yp7utEKZI_",
    "short",
    "--exec=touch /tmp/x",
    "",
    `${ID}&list=PLx`,
  ])("rejects the id %j as INVALID_URL", (id) => {
    expect(videoUrlOf(id)).toMatchObject({
      ok: false,
      error: { code: "INVALID_URL" },
    });
  });
});

describe("canonicalPlaylistUrl", () => {
  it("builds the canonical playlist URL for an id", () => {
    expect(canonicalPlaylistUrl("PLx")).toBe(
      "https://www.youtube.com/playlist?list=PLx",
    );
  });
});
