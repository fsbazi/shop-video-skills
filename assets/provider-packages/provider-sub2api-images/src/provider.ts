import { canonicalize, defineEndpoint } from "@hypit/hypit/endpoint";
import type {
  CredentialRef, EndpointRequest, EndpointSupport, ImmediateEndpointHandler,
} from "@hypit/hypit/endpoint";
import {
  compileWireRequest, generationTypes, mappingSupportsRequest, sealGeneratedImageSet,
} from "@hypit/generation";
import type { GenerationRequest, GenerationWireMapping } from "@hypit/generation";

export const providerModule = { name: "@local/provider-sub2api-images", version: "1" } as const;
export const capability = { module: { name: "@hypit/gpt-image", version: "1" }, name: "gpt-image-2" } as const;

const WIRE_MODEL = "gpt-image-2.5-sunburst";

/**
 * sub2api exposes an OpenAI-compatible images/generations endpoint. Its model picks the output
 * shape from the prompt rather than from `size`, so the author's aspect ratio travels in the
 * framing sentence while `size` still states the closest supported pixel box.
 */
const mapping: GenerationWireMapping = {
  capability, result: "image", routes: [{ model: WIRE_MODEL }],
  fields: {
    prompt: { as: "value", field: "prompt" },
    aspectRatio: { as: "value", field: "aspectRatio" },
    resolution: { as: "value", field: "resolution" },
    background: { as: "value", field: "background" },
    images: { as: "urlArray", field: "images" },
  },
};

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

function decodeDataUrl(url: string): { bytes: Uint8Array; mediaType: string } {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/u.exec(url);
  if (match === null) throw new Error("Reference image is not a data URL");
  return { bytes: Uint8Array.from(Buffer.from(match[2], "base64")), mediaType: match[1] };
}

function sizeFor(aspectRatio: string | undefined): string {
  const long = 1024;
  const short = Math.round((long * 2) / 3);
  switch (aspectRatio) {
    case "9:16": case "3:4": case "2:3": case "1:2": case "4:5": case "9:21":
      return `${short}x${long}`;
    case "16:9": case "4:3": case "3:2": case "2:1": case "21:9": case "3:1":
      return `${long}x${short}`;
    default:
      return `${long}x${long}`;
  }
}

function framingSentence(aspectRatio: string | undefined): string {
  if (aspectRatio === undefined || aspectRatio === "auto") return "";
  const label = aspectRatio === "9:16"
    ? "vertical 9:16 portrait"
    : aspectRatio === "16:9"
      ? "horizontal 16:9 widescreen"
      : aspectRatio === "1:1"
        ? "square 1:1"
        : `${aspectRatio} aspect-ratio`;
  return `\n\nCompose the image as a ${label} frame that fills the entire canvas.`;
}

function support(request: EndpointRequest): EndpointSupport {
  const ports = (request.constraints as unknown as GenerationRequest).ports;
  const resolution = ports.resolution?.[0];
  if (resolution !== undefined && resolution !== "1K") {
    return {
      status: "unsupported",
      reason: `sub2api renders at its own size near 1K; ${String(resolution)} is not a selectable tier`,
    };
  }
  return mappingSupportsRequest(mapping, request.constraints)
    ? { status: "supported" }
    : { status: "unsupported", reason: "sub2api does not accept one of the requested inputs" };
}

async function readImage(
  item: Record<string, unknown>, fetcher: typeof globalThis.fetch,
): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const url = typeof item.url === "string" ? item.url : undefined;
  if (url?.startsWith("data:")) {
    const match = /^data:([^;,]+);base64,([\s\S]+)$/u.exec(url);
    if (match === null) throw new Error("sub2api returned an invalid data URL");
    return { bytes: Uint8Array.from(Buffer.from(match[2], "base64")), mediaType: match[1] };
  }
  if (url !== undefined && /^https?:/iu.test(url)) {
    const response = await fetcher(url, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok) throw new Error(`sub2api image download returned HTTP ${response.status}`);
    const mediaType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "image/png";
    return { bytes: new Uint8Array(await response.arrayBuffer()), mediaType };
  }
  const base64 = typeof item.b64_json === "string" ? item.b64_json : undefined;
  if (base64 !== undefined && base64.length > 0) {
    return { bytes: Uint8Array.from(Buffer.from(base64, "base64")), mediaType: "image/png" };
  }
  throw new Error("sub2api returned no image for a completed generation");
}

export function createImageProvider(options: {
  instance: string;
  pool: string;
  baseUrl: string;
  apiKey: CredentialRef;
  concurrency?: number;
  requestTimeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}) {
  const base = options.baseUrl.replace(/\/$/u, "");
  const fetcher = options.fetch ?? globalThis.fetch;
  const timeout = options.requestTimeoutMs ?? 300_000;

  const handler: ImmediateEndpointHandler = async (context) => {
    const secret = text(context.credentials.apiKey?.secret);
    const request = context.need.constraints as unknown as GenerationRequest;
    await context.reportProgress?.({ phase: "Preparing image request" });
    const wire = await compileWireRequest(mapping, request, async (artifact) => {
      const bytes = await context.resources.get(artifact.resource);
      if (bytes === undefined) throw new Error("Reference image is unavailable");
      return dataUrl(bytes, artifact.mediaType);
    });
    const input = object(wire.input);
    const aspectRatio = typeof input.aspectRatio === "string" ? input.aspectRatio : undefined;
    const prompt = text(input.prompt) + framingSentence(aspectRatio);
    const size = sizeFor(aspectRatio);
    const background = typeof input.background === "string" && input.background !== "auto"
      ? input.background
      : undefined;
    const images = Array.isArray(input.images) ? input.images.map((value) => String(value)) : [];

    await context.reportProgress?.({ phase: `Rendering image with ${WIRE_MODEL}` });
    // The generations operation accepts an `images` field but ignores it. Reference-driven work
    // must use the OpenAI-compatible edits operation, where the supplied objects are preserved.
    const response = images.length > 0
      ? await fetcher(`${base}/images/edits`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
        body: (() => {
          const form = new FormData();
          form.set("model", WIRE_MODEL);
          form.set("prompt", prompt);
          form.set("size", size);
          form.set("response_format", "url");
          if (background !== undefined) form.set("background", background);
          images.forEach((value, index) => {
            const reference = decodeDataUrl(value);
            const extension = reference.mediaType.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
            form.append(
              images.length > 1 ? "image[]" : "image",
              new Blob([new Uint8Array(reference.bytes)], { type: reference.mediaType }),
              `reference-${index}.${extension}`,
            );
          });
          return form;
        })(),
        signal: AbortSignal.timeout(timeout),
      })
      : await fetcher(`${base}/images/generations`, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: WIRE_MODEL,
          prompt,
          n: 1,
          size,
          response_format: "url",
          ...(background === undefined ? {} : { background }),
        }),
        signal: AbortSignal.timeout(timeout),
      });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const operation = images.length > 0 ? "edits" : "generations";
      throw new Error(`sub2api POST /images/${operation} returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 400)}` : ""}`);
    }
    const json = object(await response.json());
    if (json.error !== undefined && json.error !== null) {
      throw new Error(`sub2api error: ${JSON.stringify(json.error).slice(0, 400)}`);
    }
    const first = Array.isArray(json.data) ? json.data[0] : undefined;
    if (first === undefined) throw new Error("sub2api returned no image data");
    const image = await readImage(object(first), fetcher);
    const artifact = await context.resources.put(image.bytes, image.mediaType);
    return { value: { kind: "inline", value: canonicalize(sealGeneratedImageSet({ images: [artifact] })) } };
  };

  return defineEndpoint({
    instance: options.instance,
    pool: options.pool,
    credentials: { apiKey: options.apiKey },
    credentialInputs: { apiKey: { label: "sub2api API key" } },
    defaultConcurrency: options.concurrency ?? 1,
    pricing: { kind: "page", url: new URL(base).origin },
    capabilities: [{
      capability,
      returns: generationTypes.imageSet,
      lifecycle: "immediate",
      supports: support,
      handler,
    }],
  });
}
