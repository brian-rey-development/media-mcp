# Recorded yt-dlp fixtures

Recorded once on 2026-11-17 with yt-dlp 2026.10.26. Tests never touch the network, they only read these files.

The video is Sintel (`eRsGyueVLvQ`, Blender Foundation, CC-BY). The video the original plan used, `jNQXAC9IWRw`, returns "This video is unavailable" from yt-dlp and from oEmbed today. Sintel was chosen because it has both manual and automatic English captions and four chapters.

| File                   | How it was produced                                   |
| ---------------------- | ----------------------------------------------------- |
| `sintel.info.json`     | Output of the first command below, trimmed            |
| `sintel.en.json3`      | Manual English captions written by the second command |
| `sintel.auto.en.json3` | Original automatic English captions, third command    |
| `playlist.flat.json`   | Fourth command below, trimmed                         |

```sh
yt-dlp --ignore-config --no-plugin-dirs --extractor-args "youtube:skip=dash,hls,translated_subs" \
  --print '%(.{id,title,channel,duration,description,chapters,subtitles,automatic_captions})j' \
  -- 'https://www.youtube.com/watch?v=eRsGyueVLvQ' > info.json

yt-dlp --ignore-config --no-plugin-dirs --skip-download --write-subs --sub-format json3 \
  --sub-langs '^en$' --no-simulate -o captions -- 'https://www.youtube.com/watch?v=eRsGyueVLvQ'

yt-dlp --ignore-config --no-plugin-dirs --skip-download --write-auto-subs --sub-format json3 \
  --sub-langs '^en-orig$' --no-simulate -o captions -- 'https://www.youtube.com/watch?v=eRsGyueVLvQ'

yt-dlp --flat-playlist --dump-single-json --playlist-start 1 --playlist-end 5 \
  -- 'https://www.youtube.com/playlist?list=PLa1F2ddGya_84ye1JAvIGh0Yp7utEKZI_' > playlist.json
```

The production code adds `--js-runtimes node:<path to node>` to every call. It was not needed to record these files.

The info call prints the eight fields of `sintel.info.json`, and `sintel.info.json` is also what the fake runner returns for the caption listing, which asks for the subset `id`, `title`, `channel`, `subtitles` and `automatic_captions`. The tests check that every field the code prints exists in this file. A transcript is normally one call that prints the listing and writes every candidate track for the language into a private working directory, with `--ignore-errors` so that a failed machine translation is only a warning. A second call that fetches only the chosen track, without `--ignore-errors`, happens only when the chosen file is missing after the first one, and it reuses the listing the first call printed. Printing only these fields keeps the output at 591 KB for Sintel against 698 KB for `--dump-single-json`, because the caption maps carry one signed URL per language and format.

Production tries each metadata request first with the fast client, which adds `;player_client=android_vr` to the extractor arguments above, passes `--ignore-no-formats-error` to every metadata request, and repeats it once with exactly the arguments above when the fast attempt fails with NO_CAPTIONS, PROCESS_FAILED or PARSE_FAILED. The fake runner returns the same recorded files for both clients, so the tests tell them apart by the arguments the runner receives. Downloads never get extractor arguments.

Trimming of `sintel.info.json`: the two caption maps keep their real language keys with empty arrays as values, and `automatic_captions` drops the thousands of `xx-yy` translation pair keys, keeping the 157 keys of the plain listing. The listing shows the three kinds of key the caption code must tell apart. Manual tracks can carry a track id suffix (`es-3pK74FgVxOs`), the original automatic track is `en-orig`, and every other automatic key such as `es` is a machine translation.

Trimming of `playlist.flat.json`: `playlist_count` is the real total of 93, while `entries` keeps four of the first five items (id, title, url, duration) and drops the one whose title contains an em dash.
