import {
  createRuntimeEndpointAdapterFacet, runtimeConfigCredentialRef, runtimeConfigExact,
  runtimeConfigObject, runtimeConfigPositiveInteger, runtimeConfigString,
} from "@hypit/runtime-local/extension";
import { createMediaProvider, providerModule } from "./provider.js";

export default {
  format: "hypit.package@1" as const,
  facets: [createRuntimeEndpointAdapterFacet({
    use: providerModule.name,
    activate(context) {
      const config = runtimeConfigObject(context.config, "TF-router media");
      runtimeConfigExact(config, ["baseUrl", "apiKey", "concurrency", "pollIntervalMs", "requestTimeoutMs"], "TF-router media");
      const baseUrl = runtimeConfigString(config.baseUrl, "TF-router media baseUrl");
      const apiKey = runtimeConfigCredentialRef(config.apiKey, "TF-router media apiKey");
      if (!baseUrl || !apiKey || !context.pool) {
        throw new Error("TF-router media requires baseUrl, apiKey and pool");
      }
      return {
        endpoint: createMediaProvider({
          instance: context.instance,
          pool: context.pool,
          baseUrl,
          apiKey,
          concurrency: runtimeConfigPositiveInteger(config.concurrency, "concurrency") ?? 2,
          pollIntervalMs: runtimeConfigPositiveInteger(config.pollIntervalMs, "pollIntervalMs") ?? 3_000,
          requestTimeoutMs: runtimeConfigPositiveInteger(config.requestTimeoutMs, "requestTimeoutMs") ?? 120_000,
        }),
      };
    },
  })],
};
