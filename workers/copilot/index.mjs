/**
 * Cloudflare Worker for the svg3dx Studio Copilot runtime.
 *
 * Pages is static, so chat goes to this host:
 *   https://copilot.dannyxu.net/api/copilotkit
 *
 * LLM keys stay in the browser (`x-studio-llm-*`). Optional host fallback:
 *   wrangler secret put OPENAI_API_KEY
 *   wrangler secret put OPENAI_BASE_URL
 *   wrangler secret put COPILOT_MODEL
 */

import { createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
import {
  HDR,
  copilotCors,
  createStudioRuntime,
  fallbackFromEnv,
  parseCorsOrigins,
} from "../../scripts/copilot-shared.mjs";

const DEFAULT_ORIGINS = [
  "https://www.dannyxu.net",
  "https://dannyxu.net",
  "https://xiaohunqupo.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const ALLOW_HEADERS = [
  "Content-Type",
  "Authorization",
  HDR.baseUrl,
  HDR.apiKey,
  HDR.model,
  HDR.userId,
];

/**
 * @param {Request} request
 * @param {string[]} origins
 */
function allowOrigin(request, origins) {
  const origin = request.headers.get("origin");
  if (origins.includes("*")) return origin || "*";
  if (origin && origins.includes(origin)) return origin;
  return origins[0] || "*";
}

/**
 * @param {Request} request
 * @param {string[]} origins
 * @param {Response} response
 */
function withCors(request, origins, response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", allowOrigin(request, origins));
  headers.set("Vary", "Origin");
  headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );
  const requested = request.headers.get("access-control-request-headers");
  headers.set(
    "Access-Control-Allow-Headers",
    requested?.trim() || ALLOW_HEADERS.join(", ")
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * @param {Request} request
 * @param {string[]} origins
 * @param {unknown} body
 * @param {number} [status]
 */
function json(request, origins, body, status = 200) {
  return withCors(
    request,
    origins,
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

export default {
  /**
   * @param {Request} request
   * @param {Record<string, string | undefined>} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const origins = parseCorsOrigins(env.COPILOT_CORS_ORIGIN, DEFAULT_ORIGINS);

    if (request.method === "OPTIONS" && !url.pathname.startsWith("/api/copilotkit")) {
      return withCors(request, origins, new Response(null, { status: 204 }));
    }

    if (url.pathname === "/" || url.pathname === "/api/health") {
      return json(request, origins, {
        ok: true,
        service: "svg3dx-studio-copilot",
        copilot: "/api/copilotkit",
      });
    }

    if (url.pathname === "/api/studio-llm-config") {
      if (request.method !== "GET") {
        return json(
          request,
          origins,
          {
            error:
              "LLM keys stay in the browser. Save them in Studio Settings; they are sent per request.",
          },
          405
        );
      }
      const fallback = fallbackFromEnv(env);
      return json(request, origins, {
        mode: "per-request",
        storesUserKeys: false,
        serverFallback: !!fallback,
        fallbackHint: fallback
          ? {
              baseUrl: fallback.baseUrl,
              model: fallback.model,
              apiKeyHint: `${fallback.apiKey.slice(0, 4)}…`,
            }
          : null,
      });
    }

    if (url.pathname.startsWith("/api/copilotkit")) {
      // Construct per request. Workers reject agent setup in global scope.
      const runtime = createStudioRuntime(() => fallbackFromEnv(env));
      const handler = createCopilotRuntimeHandler({
        runtime,
        basePath: "/api/copilotkit",
        cors: copilotCors(origins),
        activateChannels: false,
      });
      return handler(request);
    }

    return json(request, origins, { error: "not found" }, 404);
  },
};
