# media-mcp design

## Intent and why

The owner studies from YouTube material and wants an agent to turn it into better notes on a local machine. That makes plain-text transcripts the hot path, because an agent reads text far more often than it needs a video file, and it makes batches essential, because a study session usually means a playlist or a handful of lectures at once. Video download is the second capability, rarer and heavier, and it shares the same extraction machinery.

The server runs locally over stdio first. It must be shaped so that deploying it later over HTTP, and adding further sources and tools, is an addition and not a rewrite. The project is named `media-mcp` and not `youtube-mcp` because the stated future includes many other tools, and YouTube is simply the first provider (builder's call, see Calls made).

## Goals

- Fetch transcripts as plain text with no timestamps by default, for one URL, many URLs, or a playlist.
- Download videos and audio-only tracks, singly or in batches, with progress reporting and cancellation.
- Return video metadata including chapters, since chapters are the best natural outline for study notes.
- Feel fast. A cached transcript returns in milliseconds, an uncached one in 1.4 to 2.6 seconds (see the recorded decision on cold latency), and a batch runs concurrently with bounded process pools.
- Fail well. In a batch, one bad item never sinks the others, and every error is typed, human-readable and actionable.
- Stay evolvable. A new source is one adapter file, a new tool is one file, and a new transport is one entry point.

## Non-goals

- Speech-to-text for videos that have no captions (a whisper.cpp fallback is a plausible later addition, flagged here so it does not creep in).
- Login, cookies, age-restricted, members-only or private videos.
- Live stream recording.
- A GUI, a hosted service, or user accounts in version one.
- Writing the study notes themselves. The server supplies clean text and structure, and the agent does the organizing.

## Anti-goals (failures even if it technically works)

- Anything written to stdout other than MCP protocol frames, which corrupts the stdio transport.
- Silent partial failure, where a batch reports success while dropping items.
- A playlist URL quietly downloading hundreds of videos.
- A tool result large enough to flood the agent's context.
- A shell string anywhere that user input could reach.

## Constraints

- Node 22 or newer (the machine has 24), ESM only, pnpm only.
- yt-dlp is the single extraction engine for version one and must be installed on the host (Homebrew, because the system Python 3.9 is too old for the pip build). Current yt-dlp needs an external JavaScript runtime for YouTube, and Node or Bun satisfies this.
- ffmpeg is already installed and is required for merging video and audio streams.
- Project code standards come from the owner's global rules. TypeScript strict with no `any`, functional style with immutability and early returns, functions of 20 lines or fewer, named constants, validation at boundaries only, and no comments unless the reason is non-obvious.
- No commits until the owner asks. The directory is not yet a git repository, and the plan runs `git init` without committing, so the worktree question does not apply yet.

## Approaches considered

For the extraction engine there were three options. A pure TypeScript library (youtubei.js and similar) is fastest per call and needs no binary, but breaks whenever YouTube changes and depends on a single maintainer to recover. A hybrid with a fast TypeScript path and yt-dlp as fallback is the fastest and most resilient, but it doubles the surface to maintain before there is any measurement showing it is needed. yt-dlp for everything behind an interface costs 1.4 to 2.6 seconds per uncached call, mostly the extraction, which the cache and the concurrency pool hide. **The owner picked yt-dlp behind an interface**, and the interface is exactly what lets the hybrid be added later when numbers justify it.

For project layout there were two options. A single package with layered folders starts faster but makes extracting a reusable core a refactor done under pressure. A pnpm workspace with a core package and a thin server app costs a little ceremony on day one and keeps the domain free of any MCP knowledge. **The owner picked the workspace.**

## The scaffold

```
media-mcp/
  package.json                 private root, scripts delegate to workspaces
  pnpm-workspace.yaml          packages glob plus a version catalog
  tsconfig.base.json           strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes
  biome.json                   lint and format, noExplicitAny as an error
  vitest.config.ts             one Vitest project per workspace, plus scripts/
  .node-version
  README.md
  docs/superpowers/specs/      design documents
  packages/
    core/                      @media-mcp/core, no MCP imports
      src/
        domain/                Result type, MediaError codes, VideoRef, Transcript, VideoInfo
        providers/
          provider.ts          the Provider port (see below)
          registry.ts          picks a provider by URL
          youtube/             yt-dlp adapter, URL normalizer, json3 transcript parser
        composition.ts         createMediaServices, the one production wiring (process pools, YouTube provider, extra providers, registry, disk cache), shared by the server and every test harness
        services/
          run-targets.ts       the one request pipeline: expand links, announce the plan, run a worker per video
          transcripts.ts, info.ts, downloads.ts   the three use cases, each supplies only its worker
          expand.ts            links and playlists to a capped list of videos
          cached.ts            a loader bound to one schema, with shared in-flight work and a time to live
          transcript-file.ts   the saved file for a transcript over the budget (name, notice, wrapped text, atomic write)
          transcript-pages.ts  reads a saved transcript back in bounded pages, confined to the transcripts folder, for clients that cannot open server files
          cache-version.ts     the cache format version, bumped with the parser or the cached shapes
        infra/
          process.ts           execFile wrapper with timeout and AbortSignal, never a shell
          cache.ts             content-addressed disk cache
          batch.ts             runs every item, keeps input order and turns a thrown error into a failed item
          rate-limit-gate.ts, process-pools.ts   the limits that guard real yt-dlp processes, the pools use p-limit directly
          config.ts            env parsed once with zod
      test/
  apps/
    server/                    @media-mcp/server, the only package that imports the MCP SDK
      src/
        tools/                 one file per tool, each exporting defineTool(...), plus batch-output.ts with the fields every batch entry shares
        tools/read-transcript-file.ts  the fourth tool, which reads a saved transcript back in pages and is the only tool that is not a batch
        tools/index.ts         the tool registry
        bootstrap.ts           loads config, checks yt-dlp and ffmpeg, then calls createMediaServices; the logger comes from select.ts
        server.ts              builds the McpServer from the registry
        env.ts                 the names of the server's own environment variables
        cache-pruning.ts       the hourly prune timer of a long-lived server
        transports/run.ts      the steps every transport repeats, in one order: bootstrap, report a failure, shutdown, signals, the ready line
        transports/stdio.ts    a Transport for local use, which supplies only start()
        transports/select.ts   builds the logger once and picks the transport from MEDIA_MCP_TRANSPORT, stdio by default
        transports/http.ts     a Transport for Streamable HTTP, stateless, with bearer authentication, Host checks and connection limits
        transports/http-config.ts  the HTTP settings parsed from env through core's loadEnv, with a hint per failing key
        transports/http-auth.ts    constant-time bearer token check
        report-failure.ts      one startup failure report shared by the transports
        logger.ts              writes to stderr only and ignores a dead stderr
      test/
```

The Provider port is the evolvability seam for sources. It has `matches(url)`, `resolve(url)` which expands a playlist into video references under a cap, `getInfo(ref)`, `getTranscript(ref, options)` and `download(ref, options, signal)`. The registry holds a list of providers, so adding Vimeo or a podcast host is one new folder and one registry line. Services depend only on the port, which is also what makes them testable with a fake provider and no network.

The defineTool helper is the seam for tools. A tool is an object with a name, a description written for an agent, a zod input schema, a zod output schema and a handler that receives the core services and an abort signal. The server builds the MCP registrations from the registry list, so adding a tool is one file plus one export line, and no tool knows about transports.

A new transport is one file beside `stdio.ts` that exports a `Transport` whose `start(booted, lifecycle)` builds the server with the same factory, connects its SDK transport and returns `{ close, readyLine, watchesStdio }`. `transports/run.ts` owns everything else, so the shutdown order and the signal handling cannot differ between transports. Streamable HTTP is built as `transports/http.ts` plus bearer authentication and is selected with `MEDIA_MCP_TRANSPORT=http`, and a Dockerfile bundling yt-dlp and ffmpeg is still future work.

## Tools in version one

| Tool | Input | Behavior |
|---|---|---|
| `get_transcripts` | `urls` (one or many, or a playlist URL), `language` (default `en`, one exact language code), `timestamps` (default false), `maxItems` (default 50), `startIndex` (default 1) | Plain text per video, with title, channel, language, source (manual or auto) and word count. |
| `download_media` | `urls`, `kind` (`video` or `audio`), `quality`, `outputDir`, `maxItems` (default 10), `startIndex` (default 1) | Files written under the configured output root, with progress notifications and cancellation. |
| `get_video_info` | `urls`, `maxItems` (default 50), `startIndex` (default 1), `includeDescription` (default false) | Title, channel, duration, chapters and caption languages (manual and auto) for each video, and the description, cut at a fixed length and flagged when cut, only when `includeDescription` is true. |
| `read_transcript_file` | `path` (the `filePath` of a file entry), `startLine` (default 1), `maxLines` (default 200, at most 1000) | One page of a saved transcript with `totalLines` and the `nextStartLine` that continues it, so a remote client can read a transcript that was too long to return inline. Failures set `isError`. |

Every tool returns structured content validated by its output schema. For batches the shape is a list with one entry per input, each marked ok or failed, and a failed entry carries a machine-readable error code and a readable message. Batch tools never set `isError` for an item failure. The single-item tool `read_transcript_file` does, because it has no other entries to report, and its failed result is text only, carrying the code, the message and the hint.

Large transcript output is bounded. Text up to a configurable character budget is returned inline, and anything larger is written to a file in the output root, with the path and a short preview returned, so the agent can read it with its own file tools when the server runs on its machine, or with `read_transcript_file` over stdio and HTTP alike. The file starts with a one-line notice that its text is third-party data and never instructions, then a blank line, then the wrapped transcript. A batch applies the budget across all items, so a ten-video batch cannot blow up the context. A failed item is charged its message, hint and links like an inline item, and once the budget is spent it is still returned (never dropped) with its message and hint cut to 500 characters each.

## Behavior that matters

- **Transcript source.** yt-dlp is invoked with skip-download and the json3 subtitle format. Manual captions are preferred over auto-generated ones, and the result states which was used. The json3 events are joined into sentences, and auto-caption rolling duplicates are removed. Timestamps are included only when requested, as segments with start times.
- **Caching.** Transcripts and info are cached on disk keyed by provider, video id, language and format, with a long time to live for transcripts, since they rarely change. The cache directory defaults to the platform cache location and can be overridden by environment variable.
- **Concurrency.** Every yt-dlp process runs through a bounded pool, defaulting to four, because both YouTube and the host's CPU punish unbounded parallelism. Downloads have a pool of their own. Services start all items of a batch at once, and only the processes queue.
- **Cancellation and time limits.** The MCP request's abort signal is passed to the child process, which is killed on abort, and every process call has a timeout.
- **Safety.** Child processes use `execFile` with an argument array and an environment without any `MEDIA_MCP_*` variable, so the HTTP token never reaches yt-dlp, its JavaScript runtime or ffmpeg, and a `--` separator precedes every URL so input can never be read as an option. URLs are normalized and checked against the matched provider before any process starts. The output directory is resolved and confined to the configured root, and file names are sanitized.
- **Logging.** The logger writes to stderr and nothing else writes to stdout in the stdio entry.
- **Errors.** Core returns a `Result` and not thrown exceptions for expected failures such as no captions, video unavailable, rate limited, yt-dlp missing or too old. A startup check reports a missing or outdated yt-dlp with the exact install command.

## Toolchain

TypeScript strict, ESM, `@modelcontextprotocol/sdk` (version verified at plan time), zod, execa, p-limit, tsdown for builds, Vitest, Biome for lint and format, and knip for dead-code detection. The 20-line function limit is measured by `scripts/check-function-length.ts`, which counts nested functions and runs inside `pnpm lint`, because Biome's own rule skips the lines of nested functions. The script finds the workspaces to scan in `pnpm-workspace.yaml` and relies on Node's built-in TypeScript stripping, so the root `engines.node` is 22.18 while the runtime packages stay at 22.1. Turborepo is deliberately left out until the package count or CI time justifies it, because `pnpm -r` handles the dependency order of two packages without extra machinery. Test strategy has three layers. Unit tests cover the transcript parser, URL normalizer, cache and batch runner using recorded yt-dlp output fixtures. Service tests use a fake provider. A small live smoke test against a stable public video runs only when an environment variable opts in, and the MCP Inspector is used for manual end-to-end checks.

## Evolution path (not built now)

A Docker image, additional providers, a faster in-process YouTube engine as a hybrid if measurements justify it, a whisper.cpp fallback for caption-less videos, MCP resources that expose cached transcripts as `transcript://` URIs, and an MCP prompt that turns a batch of transcripts into structured study notes.

## Left to the builder

Exact CLI flags for yt-dlp, the json3 parsing details, cache file format, default quality ladder, character budget default, and test fixture selection.

## Calls made by the designer

- Project name `media-mcp`.
- Third tool `get_video_info` and chapters in its output, because chapters help note structure.
- File-or-inline output rule with a character budget, to protect agent context.
- `get_video_info` returns the description only when `includeDescription` is true (default false), and cut at a fixed length when it is. Fifty full descriptions in one result would flood the context, and chapters and caption languages are what an agent needs first. This is a recorded decision.
- Playlist cap of 50 items for transcripts and info, and a lower cap of 10 for downloads because files are large. When a playlist exceeds the cap, the result reports the truncation with the total count so nothing is silently dropped. Concurrency is 4 by default.
- Cold transcript latency is 1.4 to 1.8 seconds with the fast client and 2.2 to 2.6 seconds on the fallback, not "about a second". Measured against real yt-dlp 2026.10.26 on 2026-11-17 with Sintel (`eRsGyueVLvQ`), the default clients need 2.2 to 2.6 seconds per transcript, and `--extractor-args "youtube:skip=dash,hls,translated_subs;player_client=android_vr"` needs 1.4 to 1.75 seconds. The `android_vr` client still writes both the manual and the `-orig` automatic json3 files, needs no JavaScript runtime, and prints only a harmless warning about PO tokens. The `web`, `web_safari` and `tv` clients wrote no subtitle files and are not used. Metadata requests (info, caption listing and the single track fetch) therefore try the fast client first, and repeat once with the standard arguments (`youtube:skip=dash,hls,translated_subs` only) when the fast attempt fails with NO_CAPTIONS, PROCESS_FAILED or PARSE_FAILED. When the fast client answered NO_CAPTIONS and the standard client then fails in any other way, the fast answer is returned, because it is the truthful one, except when the standard client is rate limited, because a throttled second look must not read as "no captions" and the throttle has to surface. Every metadata request also passes `--ignore-no-formats-error`, because the fast client skips the https formats that need a PO token and a video without a plain format would otherwise fail format selection although nothing is downloaded. That flag also turns an empty format list (an unavailable or private video, a bot check, the "try again later" session rate limit, a captcha wall) into a warning with exit code 0 and a stub listing, so a runner guard placed before the rate-limit gate fails such a run again with the reason yt-dlp printed, which keeps VIDEO_UNAVAILABLE and makes a bot check, the session rate limit and the captcha wall RATE_LIMITED, so they close the gate. yt-dlp 2026.10.26 (`extractor/youtube/_video.py`) rewrites the per-IP throttle into "This content isn't available, try again later. The current session has been rate-limited by YouTube for up to an hour" and appends "YouTube is requiring a captcha challenge before playback" for the captcha wall, both through `raise_no_formats(expected=True)`. The failure rule for `try again later`, `rate-limited` and `captcha` sits before the TOOL_OUTDATED and VIDEO_UNAVAILABLE rules, because without it such a run ended as PROCESS_FAILED with an update hint, never closed the gate and sent every item of a batch through the standard client too, about 100 yt-dlp requests for 50 videos during a one-hour ban. Any other failure (an unavailable video, a rate limit, a timeout, a cancellation, a missing or outdated tool, an invalid URL) is final, because a second client would not change it. Downloads never receive extractor arguments, because skipping the DASH and HLS formats would remove the streams a download merges. Extraction by yt-dlp still dominates the time, and the cache and the bounded pools hide the rest. The evolution path (a fast TypeScript extractor in front of yt-dlp) is still the way to go below this range.
- A transcript is fetched by one yt-dlp process that lists the tracks and writes every track matching the language, so a video with both a manual `en` and an automatic `en-orig` track downloads both files and the unused one is ignored. Requesting only the chosen track needs the listing first, which means a second process and a second extraction. Measured on a video with both tracks, the single process took 3.2 to 3.5 seconds, a manual-only first pass followed by an automatic pass for videos without manual captions took 2.6 to 5.4 seconds, and the extra caption request costs about 0.4 seconds. Most videos only have automatic captions, so the two-pass design would double the cost of the common case to save a small request on the less common one. This is a recorded decision to keep one process per transcript. The pattern also matches the bare language key among the automatic captions, which is a machine translation whenever the spoken language differs, and YouTube often answers those requests with HTTP 429. Measured on 2026-11-18 with Sintel and `fr`, yt-dlp wrote the manual French file and then exited 1 on the translation, which used to look like a server-wide throttle and closed the rate-limit gate for every caller. The listing request therefore passes `--ignore-errors`, under which a failed subtitle download is only a warning while extraction errors still exit 1 (checked against a removed video). When the chosen file is still missing, one more request fetches only that track without `--ignore-errors`, so a real throttle on the track the caller wants reaches the gate. That single-track request runs at most once per transcript. It runs on the fast client only when the standard client would not follow anyway, and a track retry that ran on the fast client is the last attempt of the transcript, so the standard listing never follows it. One transcript therefore starts at most three yt-dlp requests, the fast listing, the standard listing and one single-track request on the standard client, and the retry the gate itself makes after a throttle can run each of them twice, so the true worst case is six processes, which a test counts. The usual case is one process. An English video with only automatic captions still downloads both `en` and `en-orig`, which are the same track, because manual and automatic keys share one namespace in yt-dlp's selection and a pattern cannot keep a manual `en` while dropping the automatic one.
- Process limits live at the process layer. One guarded runner pair (a request pool sized by `MEDIA_MCP_CONCURRENCY` and a separate download pool of 2) wraps every yt-dlp process with the concurrency limit and the rate-limit gate, so cache reads and links that need no process never queue and are never refused by the gate. Both pools share one gate because a throttled connection throttles everything it carries.
- One composition root. `createMediaServices(config, { run, clock?, random?, providers? })` in core builds the two process pools with the yt-dlp rate-limit predicate, the YouTube provider (plus any extra providers), the registry and the disk cache, so the server and the tests run the same wiring. `startIndex` is required on every service request, because the tools always send it and a second default in core could drift from the tool default.
- The wire boundary has two defenses that core also has. `toWireError` passes every message and hint through `redactPaths` again (idempotent), and the truncation schema is checked against core's `Truncation` at compile time. `videoId` is set once from `ref.id` for every success entry, so a tool's own fields never repeat it. Conditional spreads for optional output keys stay, because removing them would turn absent keys into keys with an undefined value and would need `| undefined` on core's request types.
- A saved transcript is read back through `services.transcriptFiles.read({ path, startLine, maxLines })`, which resolves the path inside `<output root>/transcripts` with the same confinement as downloads and opens it without following a link. It streams the file in 64 KB chunks and returns at most 1000 lines and 20000 characters per call (the default inline budget) with the next start line, so neither a large file nor a single huge line is ever held whole. The request requires `startLine` and `maxLines`, and the tool owns their defaults using the exported `DEFAULT_TRANSCRIPT_PAGE_LINES` (200), for the same reason `startIndex` is required. A missing file is FILE_NOT_FOUND, a path outside the folder or a dangling link is OUTPUT_PATH_ESCAPE.
- `read_transcript_file` exists because the HTTP transport serves clients that cannot open files on the server, and a transcript over the inline budget (about 25 minutes of speech at the default) is saved to a server-local path. The tool calls the core read service, wraps the page text in the same `untrusted_content` framing as every transcript (closing tags neutralized), and says how to continue with `startLine`. Its annotations are read-only, idempotent and closed-world. Ruling on errors: batch tools never set `isError` for an item failure, while this single-item tool does, so the agent sees an ordinary failed call with the code, message and hint in the text. The service reads only files named the way the transcript writer names them (`<provider>-<id>.<language>.plain.txt` or `.timestamps.txt`, one pattern exported next to the name builder) and at most 16 MiB, and anything else in the folder answers FILE_NOT_FOUND with a hint that only transcripts saved by `get_transcripts` can be read, so a token holder cannot use the tool as a general reader of the transcripts folder. The file is opened with O_NOFOLLOW and O_NONBLOCK, so a named pipe is refused instead of blocking a thread forever. After the open, the handle must still be the file at the checked path (same device and inode, the real path unchanged) and must have a single link, which refuses a hard link to a file outside the folder and a folder swapped for a link between the containment check and the open. The remaining assumption is plain, nobody who can write inside the output root attacks the server while it runs, beyond what those checks cover.
- Wire output bounds. The structured chapters of `get_video_info` are capped at 200 with `chaptersTruncated` present only when the cut happened, and the text block shows 50 and says how many more are not shown. Failed entries are bounded by core (messages and hints cut to 500 characters once the budget is spent), and a server test with a 50 video batch where every video failed checks that the rendered text stays under a bound derived from those caps.
- HTTP limits. The server accepts at most 64 connections (an unauthenticated peer holds a file descriptor until its headers time out, and a macOS shell allows 256 by default), drops a connection whose headers take longer than 10 seconds, gives a request 60 seconds to arrive in full and keeps an idle keep-alive connection 5 seconds. Node applies the request timeout to receiving the request only, which a test proves with a tool call that lasts longer than the timeout. SIGHUP stops the server through the same path as SIGINT and SIGTERM, so a closed terminal kills the yt-dlp and ffmpeg children, and the signal listeners are permanent, so a second signal during the shutdown is absorbed by the idempotent stop and the group SIGKILL of the children still runs instead of Node's default action ending the process first. A response of 401, 403, 404 or 405 carries `Connection: close`, which makes Node drop the socket right after the response without draining a request body that a peer sends slowly. When the bound host is not loopback, at most 16 connections per remote address are accepted, and on loopback the cap is off because a tunnel makes every client look like 127.0.0.1, and in HTTP mode the cache is pruned every hour on an unref'd timer as well as at startup.
- Identical downloads (same video, kind, quality and verified folder) running at the same time share one run, because two yt-dlp processes would share partial files and a failing one removes its leftovers. A cancelled first caller does not cancel the second, which starts its own run.
- The disk cache prunes expired entries at start and exposes `pruneExpired` for a schedule, which also removes temporary files a crash left behind for more than an hour. The cache key carries `CACHE_FORMAT_VERSION` from `services/cache-version.ts`, and a test fails when the cached shapes change without a bump.
- Playlist resolutions are remembered for five minutes in an in-memory cache driven by the injected clock, served through the same loader as info and transcripts, keyed by link, `startIndex` and `maxItems`. A failed resolution is never stored.
- A link echoed in an error message is cut at 200 characters without splitting a surrogate pair, and the transcript preview uses the same cut.
- A playlist link that yields no video, either an empty playlist or a `startIndex` past the end, is reported as a truncation with `included` 0 and the real total, and no `nextStartIndex`, so the call never returns an empty result without saying why.
- Remote access is a stateless Streamable HTTP entry that runs on the owner's own machine behind a Cloudflare Tunnel, because free cloud hosts hit YouTube's datacenter IP blocking. It uses the SDK's `StreamableHTTPServerTransport` on Node `http` with a fresh `McpServer` and transport per POST, which fits the shared `Services` (pools, gate and cache are created once per process), and it adds no HTTP framework, since there are two routes (Hono becomes worth it only when routing grows beyond a handful of paths). Auth is a single bearer token compared on SHA-256 digests with `timingSafeEqual`, the `Host` header is checked against an allow-list before authentication (DNS rebinding), failed attempts are logged as a count and a remote address only, and SSE responses stay on so progress notifications reach the client. The trust model is plain, a token holder can make the machine download into the output root and read the saved transcripts through `read_transcript_file`, which is confined to the transcripts folder. The file entry overhead used by the transcript budget is 1000 characters, measured with the real renderer on the largest realistic entry (200 character title, 100 character channel, 300 character path, 916 characters), and a test fails when the renderer outgrows it.
- Turborepo, a git hooks tool and CI deferred until needed.
- Biome over ESLint plus Prettier for speed and a single config.
