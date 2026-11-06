import {
  createRuntimeEndpointAdapterFacet, runtimeConfigCredentialRef, runtimeConfigExact,
  runtimeConfigObject, runtimeConfigPositiveInteger, runtimeConfigString,
} from "@hypit/runtime-local/extension";
import { createImageProvider, providerModule } from "./provider.js";

export default {
  format: "hypit.package@1" as const,
  facets: [createRuntimeEndpointAdapterFacet({
    use: providerModule.name,
    activate(context) {
      const config = runtimeConfigObject(context.config, "sub2api images");
      runtimeConfigExact(config, ["baseUrl", "apiKey", "concurrency", "requestTimeoutMs"], "sub2api images");
      const baseUrl = runtimeConfigString(config.baseUrl, "sub2api images baseUrl");
      const apiKey = runtimeConfigCredentialRef(config.apiKey, "sub2api images apiKey");
      if (!baseUrl || !apiKey || !context.pool) {
        throw new Error("sub2api images requires baseUrl, apiKey and pool");
      }
      return {
        endpoint: createImageProvider({
          instance: context.instance,
          pool: context.pool,
          baseUrl,
          apiKey,
          concurrency: runtimeConfigPositiveInteger(config.concurrency, "concurrency") ?? 1,
          requestTimeoutMs: runtimeConfigPositiveInteger(config.requestTimeoutMs, "requestTimeoutMs") ?? 300_000,
        }),
      };
    },
  })],
};
