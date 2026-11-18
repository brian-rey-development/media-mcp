# media-mcp

An MCP server that gives an AI agent four tools for online video, which return plain-text transcripts, metadata with chapters and downloaded files, and read back a long transcript that was saved to a file. It runs locally over stdio by default, can serve Streamable HTTP behind a bearer token for remote access, and uses yt-dlp as its only extraction engine.

It exists because studying from YouTube usually means turning lectures and playlists into notes. An agent reads text far more often than it needs a video file, so transcripts are the fast path, with timestamps off by default and long results written to a file so they never flood the agent's context. Batches are first class, one failing video never hides the others, and a cached transcript comes back in milliseconds, because a cache hit never starts a process and never waits for one. An uncached transcript is another matter. Measured against the real yt-dlp it takes about 1.5 seconds per video on the fast client and about 2.4 seconds when the fallback runs, almost all of it yt-dlp extracting the video page, while the same transcript from the cache takes about a millisecond. The project is named `media-mcp` and not `youtube-mcp` because YouTube is only the first provider.

## Requirements

- Node 22.1 or newer to run the server (24 recommended), and pnpm. Working in the repository needs Node 22.18 or newer, because `scripts/check-function-length.ts` runs on Node's built-in TypeScript stripping, which older versions lack.
- yt-dlp 2026.10.26 or newer, installed with Homebrew (`brew install yt-dlp`). The server checks the version at startup and exits with an install hint when it is missing or too old.
- A JavaScript runtime for yt-dlp is already covered. The server passes `--js-runtimes node:<path of the Node that runs it>` on every call, so the Node you start it with is the runtime and Deno is not required.
- ffmpeg, which merges video and audio streams for downloads (`brew install ffmpeg`). The server checks for it at startup and writes a warning to stderr when it is missing, transcripts and info keep working and downloads fail until it is installed.

## Install and build

```sh
pnpm install
pnpm build
```

`pnpm build` bundles the server, including the core package, into `apps/server/dist/index.js`. That single file is the entry point, run it with `node apps/server/dist/index.js`. It speaks MCP on stdin and stdout, and every log line goes to stderr.

`pnpm check` runs lint, typecheck, build, tests and the dead code check in one go. Lint is Biome plus `pnpm check:function-length`, which fails when any function in `src` or `scripts` is longer than 20 lines counting its signature, its closing brace and every nested function. A small live test against the real yt-dlp and YouTube is skipped unless you opt in.

```sh
MEDIA_MCP_LIVE=1 pnpm vitest run packages/core/test/live.test.ts
```

## Register it with Claude Code

Use the absolute path of your checkout.

```sh
claude mcp add media -- node "<abs path>/apps/server/dist/index.js"
```

Environment variables can be added with `-e`, for example `-e MEDIA_MCP_OUTPUT_DIR=/Users/you/Videos`.

## Configuration

All settings are environment variables, read once at startup. Empty values count as unset, and a bad value makes the server exit with a readable message on stderr.

| Variable                        | Default                                                                                                                                 | Meaning                                                                                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MEDIA_MCP_YTDLP_PATH`          | `yt-dlp`                                                                                                                                | The yt-dlp binary to run, use an absolute path when the client's PATH is minimal                                                                            |
| `MEDIA_MCP_OUTPUT_DIR`          | `~/Downloads/media-mcp`                                                                                                                 | Root for downloads and long transcript files, absolute path, never the filesystem root                                                                      |
| `MEDIA_MCP_CACHE_DIR`           | `~/Library/Caches/media-mcp` (macOS), `%LOCALAPPDATA%\media-mcp` (Windows), `$XDG_CACHE_HOME/media-mcp` or `~/.cache/media-mcp` (Linux) | Disk cache for transcripts and info, absolute path, expired entries are pruned in the background after startup and, in HTTP mode, every hour                |
| `MEDIA_MCP_CONCURRENCY`         | `4`                                                                                                                                     | How many yt-dlp processes run at once for info, transcripts and playlists, shared by every call of the server (1 to 16). Downloads have their own pool of 2 |
| `MEDIA_MCP_CHAR_BUDGET`         | `20000`                                                                                                                                 | Characters of transcript text returned inline in one call, see below                                                                                        |
| `MEDIA_MCP_PROCESS_TIMEOUT_MS`  | `120000` (2 minutes)                                                                                                                    | Time limit for one yt-dlp call that is not a download                                                                                                       |
| `MEDIA_MCP_DOWNLOAD_TIMEOUT_MS` | `1800000` (30 minutes)                                                                                                                  | Time limit for one download                                                                                                                                 |
| `MEDIA_MCP_MAX_DOWNLOAD_BYTES`  | `2147483648` (2 GiB)                                                                                                                    | Largest file one download may produce                                                                                                                       |
| `MEDIA_MCP_INFO_TTL_MS`         | `86400000` (24 hours)                                                                                                                   | How long cached video info stays valid                                                                                                                      |
| `MEDIA_MCP_TRANSCRIPT_TTL_DAYS` | `30`                                                                                                                                    | How long a cached transcript stays valid, automatic captions are kept 7 days at most                                                                        |
| `MEDIA_MCP_TRANSPORT`           | `stdio`                                                                                                                                 | `stdio` or `http`, see Remote access                                                                                                                        |
| `MEDIA_MCP_HTTP_TOKEN`          | none                                                                                                                                    | Required when the transport is `http`, at least 16 characters, never logged                                                                                 |
| `MEDIA_MCP_HTTP_HOST`           | `127.0.0.1`                                                                                                                             | Address the HTTP server binds to                                                                                                                            |
| `MEDIA_MCP_HTTP_PORT`           | `8787`                                                                                                                                  | Port of the HTTP server (1 to 65535)                                                                                                                        |
| `MEDIA_MCP_HTTP_ALLOWED_HOSTS`  | none                                                                                                                                    | Extra `Host` header values to accept, comma separated, for example the tunnel hostname                                                                      |

Bad values are caught when the server starts, with one exception. The output folder is only checked for being an absolute path that is not the filesystem root. It is created and verified when a download or a long transcript first needs it, so an output folder that cannot be created or written shows up as a failed entry (`IO_FAILED` or `OUTPUT_PATH_ESCAPE`) with a message, and the server keeps running. Filesystem error messages show the home folder as `~` and the temporary folder as `<tmp>`.

The character budget bounds the transcript text that one call returns inline. Text up to the budget comes back in the result, and the budget is spent in order across the videos of the call. A transcript that does not fit is written to a file instead and costs only a short preview and a header, so a later small transcript can still come back inline. Inline text is delivered in two representations, once in the structured content and once in the text block, so the real size of a result is about twice the budget.

## Tools

| Tool                   | Purpose                                                                                                           | Inputs                                                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_transcripts`      | Plain-text transcripts for one video, many videos or a playlist                                                   | `urls` (1 to 50 links), `language` (one code such as `en` or `pt-BR`, default `en`), `timestamps` (default false), `maxItems` (default 50, maximum 50), `startIndex` (default 1)                               |
| `get_video_info`       | Title, channel, duration, chapters and caption languages, and optionally the description                          | `urls`, `maxItems` (default 50, maximum 50), `startIndex` (default 1), `includeDescription` (default false, the description is cut at 2000 characters and flagged with `descriptionTruncated`)                 |
| `download_media`       | Video as mp4 or audio only as m4a, saved under the output root                                                    | `urls`, `kind` (`video` or `audio`), `quality` (`best`, `1080p`, `720p`, `480p`, `360p`, default `1080p`), `outputDir` (inside the output root), `maxItems` (default 10, maximum 50), `startIndex` (default 1) |
| `read_transcript_file` | One page of a transcript that `get_transcripts` saved to a file, for clients that cannot open files on the server | `path` (the `filePath` of the entry, at most 2048 characters), `startLine` (default 1), `maxLines` (default 200, maximum 1000)                                                                                 |

Every tool returns structured content validated by its output schema, plus a compact text block. A batch returns one entry per video, each marked ok or failed, and a failed entry carries a machine-readable error code, a message and a hint. A failure in a batch tool never sets `isError` and never stops the other entries. `read_transcript_file` is the one tool that is not a batch, so a failed read is an ordinary failed tool result with `isError` set, whose text carries the error code, the message and the hint, and the structured content is then absent. Every entry carries `url`, the canonical link of the video, and `inputUrl`, the link exactly as the caller passed it, and every successful entry also carries `videoId`, the provider's id for the video. Transcript and info entries carry the `title` and the `channel` when it is known, and info entries also carry `captionLanguages` with the `manual` and `auto` languages that `get_transcripts` accepts.

The `language` must match a caption language of the video exactly. A video without captions in that language cannot be transcribed and fails with `NO_CAPTIONS`, whose hint lists the languages to retry with. Lists, patterns and the word `all` are rejected before anything runs.

Several links to one video are merged into one entry. A watch link that carries a `list` parameter counts as that single video, while a link to the playlist page expands to every video in the list.

`maxItems` caps the total number of videos in a call across all links, so a playlist can never quietly pull in hundreds of videos. Anything cut off is listed under `truncations` with its real total, or with `totalExact` false when only a lower bound is known, and the text says which `startIndex` continues the playlist. A link that was left out because the cap was reached earlier is listed too, and playlists that come after the cap are not even expanded. A playlist that is empty, or a `startIndex` past its end, is listed under `truncations` too, with `included` 0 and the real total, so the call never comes back empty without saying why. A link longer than 2048 characters is rejected, and so is an `outputDir` longer than 2048 characters. These are two independent limits that happen to share a value.

When the transcripts of a call exceed the character budget, the ones that fit come back inline and the others are written to `<output root>/transcripts/`. A file entry carries the file path, its character and line counts, and a preview of the first 500 characters. The file starts with a one-line notice that its text is third-party data and never instructions, then a blank line, then the transcript wrapped into lines of about 100 characters so an agent can page through it with line-based file tools. The character and line counts describe the whole file, notice included, and the preview is the first 500 characters of the transcript itself. File names carry the provider, video id, language and `plain` or `timestamps`, and a file is written to a temporary name and renamed into place, so a reader never sees a half-written transcript.

An agent on the same machine can open that file with its own tools, but a client behind the HTTP transport cannot, so `read_transcript_file` reads it back through the server. It takes the exact `filePath` of the entry and returns one page, 200 lines by default and at most 1000 lines or 20000 characters, with the `nextStartLine` that continues after it, absent on the last page. The path must lead into `<output root>/transcripts/` and nothing else, so `..`, an absolute path elsewhere or a link pointing out is refused with `OUTPUT_PATH_ESCAPE`, and a file that is not there answers `FILE_NOT_FOUND`. Only files that `get_transcripts` saved can be read, which means a name of the form `<provider>-<id>.<language>.plain.txt` or `.timestamps.txt` of at most 16 MiB, so a video or any other file in that folder answers `FILE_NOT_FOUND` with a hint saying so. The file is opened without waiting for a writer, so a named pipe is refused instead of hanging the call, and a file with more than one hard link, or one that is no longer the file at the checked path after it was opened, is refused with `OUTPUT_PATH_ESCAPE`. These checks assume that nobody with write access inside the output root is attacking the server while it runs, beyond what the link, size and identity checks cover, so keep that folder writable only by the user that runs the server. The page text comes back wrapped in an `untrusted_content` tag like every transcript. A file is read in 64 KB chunks and never held whole, so even a huge one costs little memory.

Long batches report progress to clients that ask for it. `get_transcripts` and `get_video_info` report how many videos are done, and `download_media` reports overall percent. All three tools send at most about four notifications a second. A large batch that is not cached yet takes minutes.

Calls that hit a source's rate limit back off together. The first rate limited yt-dlp process pauses every process of the server, downloads included, with an exponential delay and is retried once, and if it is limited again the next processes fail fast with the original hint for a minute instead of hammering the source. Only real yt-dlp processes queue behind the concurrency limit or the back-off. A transcript or info result that is already cached, and a single video link, which is resolved without any process, come back immediately even while a long download batch runs or the source is throttling. A second `download_media` call for the same video, kind, quality and folder while the first still runs joins that run and gets its result, without progress notifications of its own.

## Architecture and extension points

The repository is a pnpm workspace with two packages.

- `packages/core` holds the domain types, the `Provider` port, the YouTube adapter on top of yt-dlp, the disk cache, the process pools with their rate-limit gate and the services. It has no MCP imports.
- `apps/server` is the only package that imports the MCP SDK. It builds an `McpServer` from a list of tool definitions and has the stdio and Streamable HTTP entries.

The server and every test harness build their services with one function, `createMediaServices(config, { run, clock?, random?, providers? })` in `packages/core/src/composition.ts`. It wires the two process pools and their shared rate-limit gate, the YouTube provider followed by any extra `providers`, the registry and the disk cache, so a test that passes a fake `run` exercises the same wiring as production. `packages/core/src/index.ts` exports only what the server uses, and the dead code check enforces it.

Metadata requests to YouTube (info, the caption listing and the track fetch) try a fast client first, `player_client=android_vr`, which needs no JavaScript runtime and takes about 1.5 seconds for a cold transcript. When the fast attempt fails with `NO_CAPTIONS`, `PROCESS_FAILED` or `PARSE_FAILED`, the same request runs once more with the standard arguments, which takes about 2.4 seconds. When the fast client found no captions and the standard client is then throttled, the throttle is what comes back, because it says the second look never happened. Any other failure is final, and downloads never use extractor arguments. A video that really has no captions in the requested language therefore costs two attempts before it reports `NO_CAPTIONS`. Every metadata request also passes `--ignore-no-formats-error`, because the fast client skips formats that need a token and a video without a plain format would otherwise fail format selection although nothing is downloaded, and a guard in front of the rate-limit gate fails a run again when yt-dlp printed that a video has no formats at all. The combined caption request passes `--ignore-errors`, so a machine translation that YouTube throttles with HTTP 429 cannot be mistaken for a throttle on the track you asked for, and a transcript starts at most three yt-dlp requests, the fast listing, the standard listing and one single-track request. The single-track request runs on the fast client only when the standard client would not follow anyway, and then it is the last attempt. The retry the gate makes after a real throttle can run each request twice, so the worst case is six processes for one transcript, and the usual case is one. A rate limit that YouTube applies to the whole session (yt-dlp reports "This content isn't available, try again later" and "rate-limited by YouTube for up to an hour") and its captcha wall both count as `RATE_LIMITED`, so they close the gate and the standard client is not tried. The child processes never receive a `MEDIA_MCP_*` variable, so the HTTP token cannot reach yt-dlp or ffmpeg.

### Add a provider

A provider is one folder in `packages/core/src/providers/` that implements the `Provider` port in `provider.ts`, with `matches`, `resolve` (which expands a playlist under a cap and reports its total), `getInfo`, `getTranscript` and `download`. For a site that yt-dlp supports, the folder reuses the generic engine in `providers/ytdlp/` and adds its own link parsing and a `provider.ts` that wires it, as `providers/youtube/` does with `urls.ts`, `refs.ts` and `provider.ts`. The folder is not the only change. Then make two edits. Add the provider to the registry list in `createMediaServices` in `packages/core/src/composition.ts`, after the YouTube provider, because the first provider that claims a link wins. Update the one sentence in `SERVER_INSTRUCTIONS` in `apps/server/src/server.ts` that names the sources. The services and tools only know the port, so nothing else changes. The services are tested with a fake provider, as `packages/core/test/services-*.test.ts` do with `test/support/fake-provider.ts`, and a test that needs a provider next to the YouTube one passes it as `providers` to `createMediaServices`, as `packages/core/test/services-composition.test.ts` does.

### Add a tool

A tool is one file in `apps/server/src/tools/` that exports a `defineTool({ name, title, description, annotations, input, output, render, handler })` value. The input and output are zod raw shapes, `render` builds the text block, and the handler receives the core services, an abort signal and `reportProgress(progress, total, message)`, which sends a progress notification when the client asked for one. Add the export to the list in `tools/index.ts`, and that is the only registration. The description is read by an agent, so say when to use the tool and what the defaults are. For a batch tool build the output from `batchOutputShape`, `successFields` and `toBatchOutput` in `tools/batch-output.ts`, which already carry `url`, `inputUrl`, `ok` and `videoId` for every entry, and the shared `title` and `channel` fields. Test it with an SDK client over `InMemoryTransport`, as the files in `apps/server/test/` do. `test/input-validation.test.ts` walks the registry, so the shared input checks reach a new tool that takes `urls` without an edit, and a tool with a required input beyond `urls` needs one line in its `REQUIRED_EXTRAS` map. A tool that takes no `urls`, like `read_transcript_file`, makes that test ask for cases of its own. A handler that is not a batch can return `toolFailure(text)` from `define-tool.ts` for an expected failure, which becomes a failed tool result with `isError` set. Add a case to `apps/server/test/integration.test.ts`, which runs the real services against a fake yt-dlp so that an output the schema rejects is caught.

### Add a transport

A transport is one file. Add a file beside `apps/server/src/transports/stdio.ts` that exports a `Transport`, an object with `start(booted, lifecycle)` that builds the server with `createServer(booted.services, lifecycle)`, connects its own SDK transport and returns `{ close, readyLine, watchesStdio }`, then add it to the choice in `apps/server/src/transports/select.ts`. Everything every transport repeats lives in `transports/run.ts`, which bootstraps, reports a startup failure, wires the graceful shutdown and the signal handling so that closing the connection aborts running work and kills the yt-dlp children, and logs the ready line. A transport that has no stdin to watch returns `watchesStdio` false, and a network transport needs its own authentication, as `transports/http.ts` does with a bearer token in `http-auth.ts`. Its settings come from `loadEnv` in core, as `transports/http-config.ts` does, and the names of its variables join the `ENV` object in `src/env.ts`.

## Troubleshooting

Startup fails fast. A missing or outdated yt-dlp, or an invalid `MEDIA_MCP_*` value such as a relative path or the filesystem root as output folder, stops the server with a message and a hint on stderr, and nothing is written to stdout. An output folder that is well formed but cannot be written does not stop startup, and it fails the downloads and long transcripts that need it. To see that message, run `node apps/server/dist/index.js` by hand in a terminal, or check the client's MCP log, or run `claude mcp list` to see whether Claude Code connected.

GUI clients and editors often start the server with a short PATH that lacks `/opt/homebrew/bin`, so a yt-dlp that works in your terminal is reported as not found. Set an absolute `MEDIA_MCP_YTDLP_PATH`, for example with `claude mcp add media -e MEDIA_MCP_YTDLP_PATH=/opt/homebrew/bin/yt-dlp -- node "<abs path>/apps/server/dist/index.js"`, and make sure `ffmpeg` and `node` are reachable from that environment too.

A `RATE_LIMITED` entry means the source is throttling this machine. Wait a few minutes before the next call, lower `MEDIA_MCP_CONCURRENCY`, and update yt-dlp, since extractor fixes ship often.

## Remote access

Free cloud hosts usually run into YouTube blocking datacenter IP ranges, so extraction often fails there even though the code is correct. The setup that works is to run the server on your own machine, where the connection is residential, and let a Cloudflare Tunnel carry the traffic to it. For that the server has a Streamable HTTP entry with bearer authentication, selected with `MEDIA_MCP_TRANSPORT=http`. The default stays stdio, so every existing client configuration keeps working.

Generate a token, start the server and expose it.

```sh
openssl rand -hex 32
MEDIA_MCP_TRANSPORT=http MEDIA_MCP_HTTP_TOKEN=<token> node apps/server/dist/index.js
cloudflared tunnel --url http://127.0.0.1:8787
```

The quick tunnel prints a `https://<random>.trycloudflare.com` hostname. A named tunnel gives a stable hostname, which is the better choice for daily use. The server only accepts requests whose `Host` header is `localhost`, `127.0.0.1` or `[::1]` with its own port, so add the tunnel hostname when you start it, which is accepted with or without the server port, for example `MEDIA_MCP_HTTP_ALLOWED_HOSTS=<random>.trycloudflare.com`. A request with any other `Host` header is refused with 403 before authentication, which is what stops a DNS rebinding attack from a web page in your browser. If you bind to another address with `MEDIA_MCP_HTTP_HOST`, add the address clients use to the same list, and the server warns on stderr because the token is then the only protection and TLS has to be terminated by a tunnel or a proxy.

Then register it in Claude Code.

```sh
claude mcp add --transport http media https://<hostname>/mcp --header "Authorization: Bearer <token>"
```

The endpoint is stateless. `POST /mcp` carries every MCP message and each request gets its own server instance, while the services (process pools, rate-limit gate, cache) are created once and shared by all requests. `GET /mcp` and `DELETE /mcp` answer 405 because there is no session or standing stream, `GET /healthz` answers 200 `ok` without a token and without touching the services, and every other path is 404. A body over 1 MiB is refused with 413. When the client disconnects, the running yt-dlp process is killed, and on SIGINT, SIGTERM or SIGHUP (a closed terminal) in-flight work is cancelled the same way as in stdio mode, which also kills the yt-dlp and ffmpeg children. A second signal while the server is shutting down is absorbed, so the process groups of those children still get their SIGKILL after the grace period instead of the second signal ending the server on the spot. A request with a missing or wrong token gets the same 401 with `WWW-Authenticate: Bearer`, the token is compared on SHA-256 digests with `crypto.timingSafeEqual`, and stderr gets one line per refused request with a count and the remote address, never the token. Behind a tunnel the remote address is the tunnel process on your machine, not the caller. An answer of 401, 403, 404 or 405 carries `Connection: close` and the socket is dropped as soon as the response is out, so a peer that was refused cannot hold the connection by sending a request body slowly.

The server limits what an unauthenticated peer can hold. It accepts at most 64 connections at once, because each takes a file descriptor and macOS shells allow 256 by default, it drops a connection that has not sent its request headers within 10 seconds, it gives a request 60 seconds to arrive in full, and an idle keep-alive connection lasts 5 seconds. When the server is bound to an address that is not loopback it also accepts at most 16 connections from one remote address, so a single peer cannot take every slot. On loopback that cap is off, because behind a tunnel on the same machine every client arrives from 127.0.0.1 and a per-address cap would limit all of them together, and a reverse proxy on another machine is one address, so the 16 then apply to everything it forwards. The request timeout covers only the time it takes to receive the request, so a long tool call that keeps its response open is never cut. Expired cache entries are pruned at startup and then every hour, on a timer that does not keep the process alive.

Treat the token like a password. Anyone who holds it can make this machine download media into `MEDIA_MCP_OUTPUT_DIR` and read the saved transcripts through `read_transcript_file`, which is confined to the `transcripts` folder of that root, although `outputDir` stays confined to the root as well. There is one token and no per-user access, so rotate it by restarting the server with a new value and updating the client.

The server uses the SDK's Node transport directly and no HTTP framework, because there are two routes and the SDK already does the protocol work. Hono, which the SDK uses internally for this transport, would only start to pay off once routing grows beyond a handful of paths.

## Evolution path

None of this is built yet.

- A Docker image that bundles yt-dlp and ffmpeg.
- More providers, for example Vimeo or podcast hosts, each one folder plus one registry line.
- A faster in-process YouTube engine next to yt-dlp, if measurements show it is needed.
- A whisper.cpp fallback for videos without captions.
- MCP resources that expose cached transcripts as `transcript://` URIs.
- An MCP prompt that turns a batch of transcripts into structured study notes.

Not planned are login, cookies, private or age-restricted videos, and live stream recording.

## License

MIT, see `LICENSE`.
