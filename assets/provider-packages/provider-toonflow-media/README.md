# `@local/provider-toonflow-media`

Implements three capabilities against TF-router's submit-and-poll operations:

| Capability | Wire model | Result |
| --- | --- | --- |
| `@hypit/seedance@1#seedance-2-mini` | `Seedance 2.0 mini` | `videoSet` |
| `@hypit/minimax-h3@1#minimax-h3` | `MiniMax-H3` | `videoSet` |
| `@hypit/fishaudio-speech@1#voice-clone` | `seed-audio-1.0` | `audioSet` |

## Configuration

| Key | Meaning |
| --- | --- |
| `baseUrl` | Service root ending in `/v1` |
| `apiKey` | Credential reference for the Bearer token |
| `concurrency` | Total simultaneous work; default 2 |
| `pollIntervalMs` | Task poll interval; default 3000 |
| `requestTimeoutMs` | Per HTTP action bound; default 120000 |

## Lifecycle

`start` submits and checkpoints the received task id. `poll` sends `{ "taskICode": "<id>" }` and
reads the state from the top level or `data.status`. `collect` downloads the signed result URL and
stores the bytes. A completed task without a result URL fails loudly.

## Service behaviour this package encodes

- Every video body includes `metadata.references`, even as `[]`. The H3 parser fails without it.
- MiniMax's `768P` model tier is written `768p` on the wire.
- MiniMax accepts no `2K`, no video references and no Web Search.
- Seedance mini accepts 480p/720p, 4–15 whole seconds, up to 9 images, 3 videos and 3 audio refs.
- `webSearch: true` is refused; the surface always supplies the port, so `false` is accepted.
- `seed-audio-1.0` is exposed through `fishaudio-speech#voice-clone`, which requires an accepted
  audio Resource as the voice identity. Output is MP3 at 24 kHz.
- References and voice samples travel as `data:` URLs; no separate upload operation is used.

## Verified evidence

- Seedance mini, 5 s, 480p, 9:16 → 496×864 H.264, ~3 min.
- MiniMax-H3, 4 s, 768P, 9:16 → 768×1344 H.264, ~2.6 min.
- seed-audio-1.0 voice clone, 7 words → 5.7 s MP3, ~33 s.
