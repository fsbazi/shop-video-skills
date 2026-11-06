# Project provider packages

Two buildable Hypit Providers for a project that connects its own image, video and speech services.
They are source packages to copy into a video project; the Distribution does not load them by
itself.

| Package | Capability | Service model | Result |
| --- | --- | --- | --- |
| `provider-sub2api-images` | `@hypit/gpt-image@1#gpt-image-2` | `gpt-image-2.5-sunburst` | `imageSet` |
| `provider-toonflow-media` | `@hypit/seedance@1#seedance-2-mini` | `Seedance 2.0 mini` | `videoSet` |
| | `@hypit/minimax-h3@1#minimax-h3` | `MiniMax-H3` | `videoSet` |
| | `@hypit/fishaudio-speech@1#voice-clone` | `seed-audio-1.0` | `audioSet` |

## Install

From the video project:

```bash
cp -r <skill>/assets/provider-packages/provider-sub2api-images packages/
cp -r <skill>/assets/provider-packages/provider-toonflow-media packages/
cd packages/provider-sub2api-images && npm install && npm run build
cd ../provider-toonflow-media && npm install && npm run build
cd ../.. && npm install ./packages/provider-sub2api-images ./packages/provider-toonflow-media
```

Then merge the endpoints and bindings from `hypit.runtime.example.json` into the project's selected
Profile. Replace the starter's hosted entry rather than extending it.

## Credentials

The Profile names a Store and a key; the value stays in the Store.

```bash
hypit auth login images.sub2api --from /private/path/sub2api-key.txt
hypit auth login media.toonflow --from /private/path/toonflow-key.txt
```

Never place a key in a Source, a Run, a Profile, a commit or the conversation.

## Verified evidence

These packages were exercised through `hypit build` in a test project:

| Work | Result |
| --- | --- |
| 9:16 image, `1K` | 941×1672 PNG, Build complete in ~8 s |
| Reference image, `1K` | `/images/edits` preserved the supplied object; the same input through `/images/generations` did not |
| Seedance 2.0 mini, 5 s, 480p, 9:16 | 496×864 H.264, Build complete in ~3 min |
| MiniMax-H3, 4 s, 768P, 9:16 | 768×1344 H.264, Build complete in ~2.6 min |
| seed-audio-1.0 voice clone, 7 words | 5.7 s MP3, Build complete in ~33 s |

The exact durations and sizes belong to the services; they are observations, not guarantees.
