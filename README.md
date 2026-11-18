# media-mcp

An MCP server that lets an AI agent read and download online video. It returns plain-text transcripts, video metadata with chapters and downloaded files, and uses yt-dlp as its only extraction engine. It runs over stdio by default and can serve Streamable HTTP behind a bearer token.

Transcripts are the fast path, because an agent reads text far more often than it needs a video file. Timestamps are off by default, long transcripts are saved to a file so they never flood the context, and one failing video never hides the others in a batch. An uncached transcript takes about 1.5 to 2.4 seconds and a cached one about a millisecond.

## Requirements

- Node 22.18 or newer and pnpm
- yt-dlp 2026.10.26 or newer (`brew install yt-dlp`), checked at startup
- ffmpeg for downloads (`brew install ffmpeg`), which only produces a warning when missing

## Install

```sh
pnpm install
pnpm build
claude mcp add media -- node "<abs path>/apps/server/dist/index.js"
```

`pnpm check` runs lint, typecheck, build, tests and the dead code check. A live test against real YouTube runs with `MEDIA_MCP_LIVE=1 pnpm vitest run packages/core/test/live.test.ts`.

## Tools

| Tool                   | Purpose                                                                                    | Main inputs                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `get_transcripts`      | Transcripts for one video, many videos or a playlist                                       | `urls`, `language` (default `en`), `timestamps` (default false) |
| `get_video_info`       | Title, channel, duration, chapters and caption languages                                   | `urls`, `includeDescription`                                    |
| `download_media`       | Video as mp4 or audio as m4a, saved under the output folder                                | `urls`, `kind`, `quality` (default `1080p`), `outputDir`        |
| `read_transcript_file` | One page of a transcript saved to a file, for clients that cannot open files on the server | `path`, `startLine`, `maxLines`                                 |

- Batch tools take 1 to 50 links plus `maxItems` and `startIndex` to page through playlists. Anything cut off is reported under `truncations`.
- Each entry is marked ok or failed, and a failure carries an error code, a message and a hint. A failure never stops the other entries.
- Transcripts that fit the character budget come back inline. The rest are saved to `<output dir>/transcripts/` with a preview, and `read_transcript_file` pages through them.
- Transcript text is wrapped in an `untrusted_content` tag, because it is third-party data and never instructions.

## Configuration

Environment variables, read once at startup. Empty counts as unset, and a bad value stops the server with a readable message.

| Variable                        | Default                 | Meaning                                                                |
| ------------------------------- | ----------------------- | ---------------------------------------------------------------------- |
| `MEDIA_MCP_YTDLP_PATH`          | `yt-dlp`                | yt-dlp binary, use an absolute path when PATH is minimal               |
| `MEDIA_MCP_OUTPUT_DIR`          | `~/Downloads/media-mcp` | Root for downloads and saved transcripts                               |
| `MEDIA_MCP_CACHE_DIR`           | OS cache folder         | Disk cache for transcripts and info                                    |
| `MEDIA_MCP_CONCURRENCY`         | `4`                     | Parallel yt-dlp processes (1 to 16), downloads use their own pool of 2 |
| `MEDIA_MCP_CHAR_BUDGET`         | `20000`                 | Transcript characters returned inline per call                         |
| `MEDIA_MCP_PROCESS_TIMEOUT_MS`  | `120000`                | Limit for one yt-dlp call that is not a download                       |
| `MEDIA_MCP_DOWNLOAD_TIMEOUT_MS` | `1800000`               | Limit for one download                                                 |
| `MEDIA_MCP_MAX_DOWNLOAD_BYTES`  | `2147483648`            | Largest file one download may produce                                  |
| `MEDIA_MCP_INFO_TTL_MS`         | `86400000`              | Cached info lifetime                                                   |
| `MEDIA_MCP_TRANSCRIPT_TTL_DAYS` | `30`                    | Cached transcript lifetime, automatic captions 7 days                  |
| `MEDIA_MCP_TRANSPORT`           | `stdio`                 | `stdio` or `http`                                                      |
| `MEDIA_MCP_HTTP_TOKEN`          | none                    | Required for `http`, at least 16 characters                            |
| `MEDIA_MCP_HTTP_HOST`           | `127.0.0.1`             | Bind address                                                           |
| `MEDIA_MCP_HTTP_PORT`           | `8787`                  | Port                                                                   |
| `MEDIA_MCP_HTTP_ALLOWED_HOSTS`  | none                    | Extra `Host` values to accept, for example a tunnel hostname           |

## Remote access

YouTube blocks most datacenter IPs, so free cloud hosts usually fail. Run the server on your own machine and expose it with a Cloudflare Tunnel.

```sh
openssl rand -hex 32
MEDIA_MCP_TRANSPORT=http MEDIA_MCP_HTTP_TOKEN=<token> \
  MEDIA_MCP_HTTP_ALLOWED_HOSTS=<tunnel hostname> node apps/server/dist/index.js
cloudflared tunnel --url http://127.0.0.1:8787
claude mcp add --transport http media https://<hostname>/mcp --header "Authorization: Bearer <token>"
```

- `POST /mcp` carries MCP, `GET /healthz` answers 200 without a token, and every other route is refused.
- Requests need the bearer token and an allowed `Host` header, which also blocks DNS rebinding.
- Connections, header time and body size are capped. The server warns when bound to a non-loopback address.
- Anyone with the token can make the machine download into the output folder and read saved transcripts, so treat it like a password. There is one token, and restarting with a new one rotates it.

## Architecture

- `packages/core` holds the domain types, the `Provider` port, the yt-dlp YouTube adapter, the disk cache, the process pools with a shared rate-limit gate, and the services. It has no MCP imports.
- `apps/server` is the only package that imports the MCP SDK. It defines the tools and the stdio and HTTP transports.
- `createMediaServices` in `packages/core/src/composition.ts` wires everything for both production and tests.
- Metadata requests try yt-dlp's fast `android_vr` client first and fall back once to the standard client. A rate limit pauses every yt-dlp process and retries once.

To extend it, add a provider as one folder in `packages/core/src/providers/` plus a line in `composition.ts`, a tool as one file in `apps/server/src/tools/` plus an export in `tools/index.ts`, and a transport as one file in `apps/server/src/transports/` plus a line in `select.ts`.

## Troubleshooting

- The server fails fast on a missing yt-dlp or a bad setting, with the reason on stderr. Run `node apps/server/dist/index.js` by hand or `claude mcp list` to see it.
- GUI clients often have a short PATH. Set `MEDIA_MCP_YTDLP_PATH` to an absolute path.
- `RATE_LIMITED` means YouTube is throttling this machine. Wait a few minutes, lower `MEDIA_MCP_CONCURRENCY`, and update yt-dlp.

## License

MIT, see `LICENSE`.
