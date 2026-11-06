# `@local/provider-sub2api-images`

Implements `@hypit/gpt-image@1#gpt-image-2` against a sub2api OpenAI-compatible image endpoint.

## Configuration

| Key | Meaning |
| --- | --- |
| `baseUrl` | Service root ending in `/v1` |
| `apiKey` | Credential reference for the Bearer token |
| `concurrency` | Simultaneous image requests; default 1 |
| `requestTimeoutMs` | Per-request bound; default 300000 |

## Mapping

| Model port | Wire field | Note |
| --- | --- | --- |
| `prompt` | `prompt` | A short framing sentence is appended when an aspect ratio is present |
| `aspectRatio` | `size`, prompt | The service ignores `size`; the prompt decides the output shape |
| `resolution` | — | `1K` only; `2K` and `4K` are refused by `supports` |
| `background` | `background` | `transparent` and `opaque` pass through; `auto` omitted |
| `images` | `image` / `image[]` on `/images/edits` | Reference work uses the multipart edits operation; the generations `images` field is ignored by the service |

## Result

The service returns a data URL or `b64_json` in `data[0]`. The Provider decodes it, stores the bytes
through `context.resources` and returns a generated image set. The verified 9:16 `1K` request
produced 941×1672.

A reference request with a red polka-dot cube and a blue sphere preserved both objects through
`/images/edits`. The same supplied images through `/images/generations` were ignored: the returned
picture was a different object with only the motif loosely echoed.

## Limits

- `supports` refuses `2K` and `4K` because the service exposes no selectable resolution tier; the
  output is roughly 1.5 megapixels.
- The returned pixel box is model-chosen; use `aspect-ratio` for shape and accept the service's size.
- `pricing` points at the service origin; the package does not invent rates.
