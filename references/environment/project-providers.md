# Connect project-owned providers

Read this when the production uses its own image, video or speech services instead of a
Distribution-shipped Provider, when a supplied service must be connected as a Provider, or when an
existing provider package must be installed, bound or diagnosed. [Models and Providers](model-and-provider.md) owns
the capability decision; [Profile](profile.md) owns configuration, credentials and routing.
This page owns the concrete project installation that accompanies those two references.

## Keep the three layers separate

| Layer | What it decides | Where it lives |
| --- | --- | --- |
| Model | Authored meaning: prompt, references, duration, resolution, result type | Installed model package, addressed as `@hypit/<model>@1#<capability>` |
| Provider | Transport: upload, submit, poll, collect, limits, pricing | Project package declared under an Endpoint `use` |
| Profile | Which Endpoint fulfils which capability, and where its secret lives | `hypit.runtime.json` |

A Provider never redefines a Model. It maps that Model's declared ports onto one service's wire
fields and reports the service's real limits. A Model is not edited to fit one service.

## The two packages shipped with this Skill

`assets/provider-packages/` contains two complete, buildable Providers. They are examples to copy
into a video project, not packages the Distribution loads on its own.

| Package | Implements | Service model | Result |
| --- | --- | --- | --- |
| `@local/provider-sub2api-images` | `@hypit/gpt-image@1#gpt-image-2` | `gpt-image-2.5-sunburst` | `imageSet` |
| `@local/provider-toonflow-media` | `@hypit/seedance@1#seedance-2-mini` | `Seedance 2.0 mini` | `videoSet` |
| | `@hypit/minimax-h3@1#minimax-h3` | `MiniMax-H3` | `videoSet` |
| | `@hypit/fishaudio-speech@1#voice-clone` | `seed-audio-1.0` | `audioSet` |

The image package uses an OpenAI-compatible `POST /images/generations` operation and returns its
picture as a data URL. The media package uses TF-router's submit-and-poll operations:
`POST /video/generateVideo` with `POST /video/getVideoStatus`, and `POST /tts/create` with
`POST /tts/getAudioStatus`.

## Install a provider package

Copy the package into the video project, or install the built tarball. From the video project:

```bash
cp -r <skill>/assets/provider-packages/provider-sub2api-images packages/
cp -r <skill>/assets/provider-packages/provider-toonflow-media packages/
cd packages/provider-sub2api-images && npm install && npm run build
cd ../provider-toonflow-media && npm install && npm run build
cd ../.. && npm install ./packages/provider-sub2api-images ./packages/provider-toonflow-media
```

The package is selected by its `use` name and activated by the Runtime's facet. Installing it does
not connect an account or submit work; the Profile's Endpoint entry does that.

## Merge the Profile fragment

Keep the project's existing `media.local` and renderer entries; add the two Endpoints and the four
bindings:

```json
{
  "credentials": {
    "local": { "use": "@hypit/credential-store-local" }
  },
  "endpoints": {
    "images.sub2api": {
      "use": "@local/provider-sub2api-images",
      "pool": "sub2api",
      "config": {
        "baseUrl": "https://<host>/v1",
        "apiKey": { "store": "local", "key": "sub2api.images" }
      }
    },
    "media.toonflow": {
      "use": "@local/provider-toonflow-media",
      "pool": "toonflow",
      "config": {
        "baseUrl": "https://api.toonflow.net/v1",
        "apiKey": { "store": "local", "key": "toonflow.media" }
      }
    }
  },
  "bindings": {
    "@hypit/gpt-image@1#gpt-image-2": "images.sub2api",
    "@hypit/seedance@1#seedance-2-mini": "media.toonflow",
    "@hypit/minimax-h3@1#minimax-h3": "media.toonflow",
    "@hypit/fishaudio-speech@1#voice-clone": "media.toonflow"
  }
}
```

One Endpoint can offer several capabilities; the media Endpoint serves video and speech because
they share one account, base address and quota. Bind by the complete capability key, not by a vendor
model label.

## Put the keys in the store

The Profile names a Store and a key; the value never belongs in the Profile, a Source, a Run or the
conversation. After the Profile is selected:

```bash
hypit auth login images.sub2api --from /private/path/sub2api-key.txt
hypit auth login media.toonflow --from /private/path/toonflow-key.txt
hypit auth status images.sub2api
```

`--from` imports a private file into the writable Store. Interactive login uses secure terminal
input. An environment-backed deployment may declare `@hypit/credential-store-env` instead, but the
Worker must receive the same variable at startup.

## Verify before spending

```bash
hypit plan ./production.svrun
hypit pricing ./production.svrun
```

`plan` resolves the binding, checks `supports` against the concrete request and reports the named
Endpoint. A support rejection is the Provider stating a real service limit before a paid job is
submitted. `build` then submits the work; `--follow` only watches, and closing it does not cancel
the Build.

## What each service actually honours

### sub2api images

- `aspect-ratio` is carried as a short framing sentence appended to the prompt. The service's
  `size` parameter is advisory: its model chooses the output box from the prompt. A 9:16 request
  was measured at 941×1672; a 16:9 request at 1536×1024.
- `resolution` accepts `1K` only. `2K` and `4K` are refused because the service exposes no
  selectable tier; the returned picture is roughly 1.5 megapixels regardless.
- `background` is honoured (`transparent`, `opaque`); `auto` is omitted.
- Reference images route to `POST /images/edits` as a multipart `image` or `image[]` upload. The
  generations operation accepts an `images` field but ignores it; edits preserves the supplied
  objects. A test with two references kept both objects exactly. Up to 16 references follow the
  model's port limit.
- The Provider returns the bytes through `context.resources`; no vendor URL is retained.

### TF-router video

- `Seedance 2.0 mini` accepts 480p/720p, 4–15 whole seconds, and up to 9 image, 3 video and 3 audio
  references. `MiniMax-H3` accepts its own `768p` tier, 4–15 seconds, up to 9 images and 3 audio
  references; it does not accept video references or `2K`.
- The task id is the response's `data` string. Polling sends `{ "taskICode": "<id>" }`; the state
  is read from the top level or `data.status`; the result URL is `data.data`.
- `metadata.references` must be present on every video request, even as `[]`. Its absence makes the
  H3 parser fail with a server-side error rather than a useful message.
- MiniMax's tier is written `768p` on the wire although the Hypit model names it `768P`.
- Web Search is not available; a request that sets it to `true` is refused before submission.

### TF-router speech

- `seed-audio-1.0` is an ordinary TTS operation with optional voice references. Hypit exposes it
  through `fishaudio-speech#voice-clone`, so the request needs an accepted audio Resource as the
  voice identity. A `VoiceDesign` request has no equivalent service operation and is not offered.
- Before authoring narration, ask the user to upload a clean reference clip (or accept an existing
  A-roll passage) when the work needs a voice they have not supplied. This Skill does not expose a
  default-voice TTS request.
- Output is MP3 at 24 kHz. The signed result URL is collected through `context.resources`; the
  account key is never sent to the download host.
- Speech-rate, loudness and pitch are sent as the service's percentage fields with neutral values.

## Write another provider

Follow one real request through the public boundary:

1. Name the exact capability and result type. Use the Model's own port table; do not import the
   Model package.
2. Map every declared port to one wire field. Refuse a supplied port or item field the mapping
   cannot carry instead of dropping it.
3. Implement the service's actual lifecycle. Synchronous work is an immediate handler; remote task
   work implements `start`, `poll` and `collect`, and checkpoints the received task id before
   returning.
4. Admit returned bytes through `context.resources` and return the declared result type.
5. Declare real limits in `supports` and a reachable `pricing` source.

`assertMappingCoversPorts` catches a mapping that forgets a required port or item field. Add
request-level tests for optional fields and for the service's own state vocabulary. The
Distribution's `examples/provider-package/` is the reference for the SDK shape; this page's
packages show two working service mappings.

A service that reuses an existing Model changes only the transport. A service with author semantics
the Model cannot express needs a new project Model first; adding one is ordinary project work, not
a Provider change.

## Diagnose the actual failure

| Evidence | What it establishes |
| --- | --- |
| `RUNTIME_CREDENTIAL_MISSING` in `plan` | The Endpoint is selected but its declared Store has no value |
| `unsupported` with a duration/resolution reason | The Provider's `supports` refused the request before submission |
| HTTP 4xx from the submit operation | The service rejected the request; read its `message` and error code |
| A received task id followed by a failed poll | The remote job exists but did not finish; keep the id as evidence |
| A completed task without a result URL | A service contract violation, not a pending job |
| A support rejection despite a valid request | The mapping lacks a port the Model supplies, commonly an optional boolean |

`hypit doctor --endpoint <instance>` checks reachability without submitting generation. `plan` and
`pricing` do not prove that a paid request has already succeeded.
