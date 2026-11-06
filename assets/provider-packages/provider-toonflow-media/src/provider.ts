import { canonicalize, defineEndpoint, wakeAfter } from "@hypit/hypit/endpoint";
import type {
  AsyncEndpoint, CredentialRef, EndpointOutcome, EndpointPollContext, EndpointRequest,
  EndpointStartContext, EndpointSupport,
} from "@hypit/hypit/endpoint";
import {
  compileWireRequest, generationTypes, mappingSupportsRequest, sealGeneratedAudioSet,
  sealGeneratedVideoSet, selectWireModelForRequest,
} from "@hypit/generation";
import type { GenerationRequest, GenerationWireMapping } from "@hypit/generation";

export const providerModule = { name: "@local/provider-toonflow-media", version: "1" } as const;

export const seedanceCapability = { module: { name: "@hypit/seedance", version: "1" }, name: "seedance-2-mini" } as const;
export const minimaxCapability = { module: { name: "@hypit/minimax-h3", version: "1" }, name: "minimax-h3" } as const;
export const voiceCloneCapability = { module: { name: "@hypit/fishaudio-speech", version: "1" }, name: "voice-clone" } as const;

const SEEDANCE_MODEL = "Seedance 2.0 mini";
const MINIMAX_MODEL = "MiniMax-H3";
const AUDIO_MODEL = "seed-audio-1.0";

/** TF-router accepts every reference role in one ordered array; each port therefore maps to its own temporary key. */
const videoFields = {
  prompt: { as: "value", field: "prompt" },
  duration: { as: "value", field: "duration" },
  resolution: { as: "value", field: "resolution" },
  aspectRatio: { as: "value", field: "ratio" },
  generateAudio: { as: "value", field: "generateAudio" },
  // The Seedance surface always supplies this port; TF-router has no Web Search operation, so a
  // present `false` is accepted and `true` is refused by support before submission.
  webSearch: { as: "value", field: "webSearch" },
  referenceImage: { as: "itemObject", field: "referenceImages", urlKey: "url", fieldKeys: { personReference: "person" } },
  referenceVideo: { as: "itemObject", field: "referenceVideos", urlKey: "url", fieldKeys: { personReference: "person" } },
  referenceAudio: { as: "urlArray", field: "referenceAudios" },
  firstFrame: { as: "url", field: "firstFrame", resourceFields: ["personReference"] },
  lastFrame: { as: "url", field: "lastFrame", resourceFields: ["personReference"] },
} as const;

const seedanceMapping: GenerationWireMapping = {
  capability: seedanceCapability, result: "video", routes: [{ model: SEEDANCE_MODEL }],
  fields: videoFields,
};

const minimaxMapping: GenerationWireMapping = {
  capability: minimaxCapability, result: "video", routes: [{ model: MINIMAX_MODEL }],
  fields: {
    prompt: videoFields.prompt,
    duration: videoFields.duration,
    resolution: videoFields.resolution,
    aspectRatio: videoFields.aspectRatio,
    referenceImage: videoFields.referenceImage,
    referenceAudio: videoFields.referenceAudio,
    firstFrame: videoFields.firstFrame,
    lastFrame: videoFields.lastFrame,
  },
};

const voiceCloneMapping: GenerationWireMapping = {
  capability: voiceCloneCapability, result: "audio", routes: [{ model: AUDIO_MODEL }],
  fields: {
    text: { as: "value", field: "text" },
    voiceReference: { as: "url", field: "voice" },
  },
};

const SUCCESS = new Set(["success", "completed", "succeeded"]);
const FAILURE = new Set(["failed", "failure", "error", "rejected"]);

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a service object");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new Error("Expected nonempty service text");
  return value;
}

function dataUrl(bytes: Uint8Array, mediaType: string): string {
  return `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function portsOf(request: EndpointRequest): GenerationRequest["ports"] {
  return (request.constraints as unknown as GenerationRequest).ports;
}

function count(ports: GenerationRequest["ports"], name: string): number {
  return ports[name]?.length ?? 0;
}

function unsupported(reason: string): EndpointSupport {
  return { status: "unsupported", reason };
}

type VideoSpec = {
  readonly mapping: GenerationWireMapping;
  readonly model: string;
  readonly defaultResolution: string;
  readonly resolutions: ReadonlySet<string>;
  readonly resolutionWire: Readonly<Record<string, string>>;
  readonly ratios: ReadonlySet<string>;
  readonly maxImages: number;
  readonly maxVideos: number;
  readonly maxAudios: number;
};

const SEEDANCE_SPEC: VideoSpec = {
  mapping: seedanceMapping,
  model: SEEDANCE_MODEL,
  defaultResolution: "720p",
  resolutions: new Set(["480p", "720p"]),
  resolutionWire: {},
  ratios: new Set(["1:1", "4:3", "3:4", "16:9", "9:16"]),
  maxImages: 9,
  maxVideos: 3,
  maxAudios: 3,
};

const MINIMAX_SPEC: VideoSpec = {
  mapping: minimaxMapping,
  model: MINIMAX_MODEL,
  defaultResolution: "768p",
  resolutions: new Set(["768P"]),
  // The H3 model names its tier `768P`; the TF-router wire value is lowercase.
  resolutionWire: { "768P": "768p" },
  ratios: new Set(["1:1", "4:3", "3:4", "16:9", "9:16"]),
  maxImages: 9,
  maxVideos: 0,
  maxAudios: 3,
};

function videoSupport(spec: VideoSpec, request: EndpointRequest): EndpointSupport {
  const ports = portsOf(request);
  const duration = ports.duration?.[0];
  if (typeof duration === "number" && (duration < 4 || duration > 15 || !Number.isInteger(duration))) {
    return unsupported(`TF-router ${spec.model} renders 4–15 whole seconds, not ${String(duration)}`);
  }
  const resolution = ports.resolution?.[0];
  if (resolution !== undefined && !spec.resolutions.has(String(resolution))) {
    return unsupported(`TF-router ${spec.model} renders at ${[...spec.resolutions].join("/")}, not ${String(resolution)}`);
  }
  const aspect = ports.aspectRatio?.[0];
  if (aspect !== undefined && !spec.ratios.has(String(aspect))) {
    return unsupported(`TF-router ${spec.model} accepts ${[...spec.ratios].join(", ")}, not ${String(aspect)}`);
  }
  if (ports.webSearch?.[0] === true) {
    return unsupported(`TF-router ${spec.model} does not expose Web Search`);
  }
  if (count(ports, "referenceImage") > spec.maxImages) {
    return unsupported(`TF-router ${spec.model} accepts at most ${spec.maxImages} reference images`);
  }
  if (count(ports, "referenceVideo") > spec.maxVideos) {
    return unsupported(`TF-router ${spec.model} accepts at most ${spec.maxVideos} reference videos`);
  }
  if (count(ports, "referenceAudio") > spec.maxAudios) {
    return unsupported(`TF-router ${spec.model} accepts at most ${spec.maxAudios} reference audios`);
  }
  return mappingSupportsRequest(spec.mapping, request.constraints)
    ? { status: "supported" }
    : unsupported("TF-router does not accept one of the requested inputs");
}

function audioSupport(request: EndpointRequest): EndpointSupport {
  return mappingSupportsRequest(voiceCloneMapping, request.constraints)
    ? { status: "supported" }
    : unsupported("seed-audio-1.0 does not accept one of the requested inputs");
}

function referenceEntry(url: string, role: string): Record<string, unknown> {
  const type = role === "reference_video" ? "video_url" : role === "reference_audio" ? "audio_url" : "image_url";
  return { role, type, [type]: { url } };
}

function buildVideoBody(
  input: Record<string, unknown>, spec: VideoSpec,
): Record<string, unknown> {
  const references: Record<string, unknown>[] = [];
  const addArray = (value: unknown, role: string) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      const url = typeof item === "string"
        ? item
        : item !== null && typeof item === "object" && typeof (item as Record<string, unknown>).url === "string"
          ? String((item as Record<string, unknown>).url)
          : undefined;
      if (url !== undefined) references.push(referenceEntry(url, role));
    }
  };
  addArray(input.referenceImages, "reference_image");
  addArray(input.referenceVideos, "reference_video");
  addArray(input.referenceAudios, "reference_audio");
  if (typeof input.firstFrame === "string") references.push(referenceEntry(input.firstFrame, "first_frame"));
  if (typeof input.lastFrame === "string") references.push(referenceEntry(input.lastFrame, "last_frame"));

  const authored = input.resolution === undefined ? undefined : String(input.resolution);
  const resolution = authored === undefined
    ? spec.defaultResolution
    : (spec.resolutionWire[authored] ?? authored);
  const metadata: Record<string, unknown> = { resolution };
  if (typeof input.ratio === "string") metadata.ratio = input.ratio;
  if (typeof input.generateAudio === "boolean") metadata.generate_audio = input.generateAudio;
  // TF-router's own client always sends this array; its absence breaks the H3 request parser.
  metadata.references = references;

  return {
    model: spec.model,
    prompt: text(input.prompt),
    duration: input.duration,
    resolution,
    metadata,
  };
}

function buildAudioBody(input: Record<string, unknown>): Record<string, unknown> {
  const voice = text(input.voice);
  const comma = voice.indexOf(",");
  const reference = voice.startsWith("data:") && comma > 0
    ? { audio_data: voice.slice(comma + 1) }
    : { audio_url: voice };
  return {
    model: AUDIO_MODEL,
    text: text(input.text),
    format: "mp3",
    sampleRate: 24_000,
    speechRate: 0,
    loudnessRate: 0,
    pitchRate: 0,
    references: [reference],
  };
}

async function readTaskUrl(json: Record<string, unknown>): Promise<string> {
  const data = json.data !== null && typeof json.data === "object" && !Array.isArray(json.data)
    ? object(json.data)
    : {};
  const status = String(json.status ?? data.status ?? "").toLowerCase();
  if (FAILURE.has(status)) {
    const reason = typeof data.failReason === "string" ? data.failReason : undefined;
    throw Object.assign(new Error(reason ?? "TF-router task failed"), { code: "TOONFLOW_TASK_FAILED" });
  }
  if (!SUCCESS.has(status)) throw new Error(`TF-router returned unexpected task state "${status}"`);
  return text(data.data ?? json.result);
}

async function download(
  fetcher: typeof globalThis.fetch, url: string, fallbackMediaType: string, expected: string,
): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const response = await fetcher(url, { signal: AbortSignal.timeout(600_000) });
  if (!response.ok) throw new Error(`TF-router result download returned HTTP ${response.status}`);
  const header = response.headers.get("content-type")?.split(";")[0]?.trim();
  const mediaType = header !== undefined && header.startsWith(expected) ? header : fallbackMediaType;
  return { bytes: new Uint8Array(await response.arrayBuffer()), mediaType };
}

export function createMediaProvider(options: {
  instance: string;
  pool: string;
  baseUrl: string;
  apiKey: CredentialRef;
  concurrency?: number;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}) {
  const base = options.baseUrl.replace(/\/$/u, "");
  const fetcher = options.fetch ?? globalThis.fetch;
  const interval = options.pollIntervalMs ?? 3_000;
  const requestTimeout = options.requestTimeoutMs ?? 120_000;
  const key = (credentials: Readonly<Record<string, { secret: string }>>) =>
    text(credentials.apiKey?.secret);

  async function call(
    secret: string, path: string, body: unknown,
  ): Promise<Record<string, unknown>> {
    const response = await fetcher(`${base}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(requestTimeout),
    });
    const raw = await response.text();
    let json: Record<string, unknown> | undefined;
    try {
      json = object(JSON.parse(raw));
    } catch {
      json = undefined;
    }
    if (!response.ok) {
      throw new Error(`TF-router POST ${path} returned HTTP ${response.status}${raw ? `: ${raw.slice(0, 400)}` : ""}`);
    }
    if (json === undefined) throw new Error("TF-router returned a non-JSON response");
    const code = typeof json.code === "string" ? Number(json.code) : json.code;
    if (typeof code === "number" && code !== 200) {
      throw new Error(`TF-router POST ${path} failed: ${String(json.message ?? code)}`);
    }
    return json;
  }

  async function startTask(
    context: EndpointStartContext, path: string, body: unknown,
  ): Promise<EndpointOutcome> {
    const secret = key(context.credentials);
    await context.reportProgress?.({ phase: `Submitting ${path}` });
    const json = await call(secret, path, body);
    const id = text(json.data);
    const handle = { id };
    await context.checkpoint?.({ handle, receipt: { id } });
    return { ...wakeAfter(handle, interval), receipt: { id } };
  }

  async function pollTask(
    context: EndpointPollContext, path: string,
  ): Promise<{ id: string; url: string } | EndpointOutcome> {
    const id = text(object(context.handle).id);
    const json = await call(key(context.credentials), path, { taskICode: id });
    const data = json.data !== null && typeof json.data === "object" && !Array.isArray(json.data)
      ? object(json.data)
      : {};
    const status = String(json.status ?? data.status ?? "").toLowerCase();
    if (SUCCESS.has(status)) return { id, url: text(data.data ?? json.result) };
    if (FAILURE.has(status)) {
      const reason = typeof data.failReason === "string" ? data.failReason : String(json.message ?? "task failed");
      return {
        status: "failed",
        receipt: { id },
        failure: { code: "TOONFLOW_TASK_FAILED", message: `TF-router task ${id} failed: ${reason}` },
      };
    }
    return wakeAfter({ id }, interval, Date.now(), { phase: status || "running" });
  }

  const videoEndpoint = (spec: VideoSpec): AsyncEndpoint => ({
    async start(context) {
      const supported = videoSupport(spec, context.need);
      if (supported.status === "unsupported") throw new Error(supported.reason);
      const authored = context.need.constraints as unknown as GenerationRequest;
      const model = selectWireModelForRequest(spec.mapping, authored);
      const wire = await compileWireRequest(spec.mapping, authored, async (artifact) => {
        const bytes = await context.resources.get(artifact.resource);
        if (bytes === undefined) throw new Error("Reference media is unavailable");
        return dataUrl(bytes, artifact.mediaType);
      });
      await context.reportProgress?.({ phase: `Preparing video request: ${model}` });
      return startTask(context, "/video/generateVideo", buildVideoBody(object(wire.input), spec));
    },
    async poll(context) {
      const result = await pollTask(context, "/video/getVideoStatus");
      if ("status" in result) return result;
      return { status: "ready", handle: { id: result.id, url: result.url } };
    },
    async collect(context) {
      const url = text(object(context.handle).url);
      await context.reportProgress?.({ phase: "Receiving generated video" });
      const media = await download(fetcher, url, "video/mp4", "video/");
      const artifact = await context.resources.put(media.bytes, media.mediaType);
      return {
        status: "completed",
        result: { value: { kind: "inline", value: canonicalize(sealGeneratedVideoSet({ videos: [artifact] })) } },
      };
    },
  });

  const audioEndpoint: AsyncEndpoint = {
    async start(context) {
      const supported = audioSupport(context.need);
      if (supported.status === "unsupported") throw new Error(supported.reason);
      const authored = context.need.constraints as unknown as GenerationRequest;
      const wire = await compileWireRequest(voiceCloneMapping, authored, async (artifact) => {
        const bytes = await context.resources.get(artifact.resource);
        if (bytes === undefined) throw new Error("Voice reference is unavailable");
        return dataUrl(bytes, artifact.mediaType);
      });
      await context.reportProgress?.({ phase: `Preparing speech request: ${AUDIO_MODEL}` });
      return startTask(context, "/tts/create", buildAudioBody(object(wire.input)));
    },
    async poll(context) {
      const result = await pollTask(context, "/tts/getAudioStatus");
      if ("status" in result) return result;
      return { status: "ready", handle: { id: result.id, url: result.url } };
    },
    async collect(context) {
      const url = text(object(context.handle).url);
      await context.reportProgress?.({ phase: "Receiving generated speech" });
      const media = await download(fetcher, url, "audio/mpeg", "audio/");
      const artifact = await context.resources.put(media.bytes, media.mediaType);
      return {
        status: "completed",
        result: { value: { kind: "inline", value: canonicalize(sealGeneratedAudioSet({ audios: [artifact] })) } },
      };
    },
  };

  const capabilities = [
    {
      capability: seedanceCapability,
      returns: generationTypes.videoSet,
      lifecycle: "asynchronous" as const,
      supports: (request: EndpointRequest) => videoSupport(SEEDANCE_SPEC, request),
      endpoint: videoEndpoint(SEEDANCE_SPEC),
    },
    {
      capability: minimaxCapability,
      returns: generationTypes.videoSet,
      lifecycle: "asynchronous" as const,
      supports: (request: EndpointRequest) => videoSupport(MINIMAX_SPEC, request),
      endpoint: videoEndpoint(MINIMAX_SPEC),
    },
    {
      capability: voiceCloneCapability,
      returns: generationTypes.audioSet,
      lifecycle: "asynchronous" as const,
      supports: audioSupport,
      endpoint: audioEndpoint,
    },
  ];

  return defineEndpoint({
    instance: options.instance,
    pool: options.pool,
    credentials: { apiKey: options.apiKey },
    credentialInputs: { apiKey: { label: "TF-router API key" } },
    defaultConcurrency: options.concurrency ?? 2,
    actionLimits: { submit: { concurrency: 2 }, poll: { concurrency: 8 }, collect: { concurrency: 2 } },
    pricing: { kind: "page", url: new URL(base).origin },
    capabilities,
  });
}
