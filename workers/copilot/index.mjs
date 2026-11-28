/**
 * Cloudflare Worker for the svg3dx Studio Copilot runtime.
 *
 * Chat is cross-origin. Relay routes accept only Origins listed in the
 * runtime variable COPILOT_CORS_ORIGIN (Worker dashboard). No list means deny.
 * A browser on another site cannot set Origin, so it cannot use this
 * worker as a proxy. Health checks stay open.
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

const ALLOW_HEADERS = [
  "Content-Type",
  "Authorization",
  HDR.baseUrl,
  HDR.apiKey,
  HDR.model,
  HDR.userId,
];

/**
 * Relay routes only. Browsers set Origin and page scripts cannot override it.
 * @param {Request} request
 * @param {string[]} origins
 */
function originAllowed(request, origins) {
  if (origins.includes("*")) return true;
  const origin = request.headers.get("origin")?.trim() ?? "";
  return origin.length > 0 && origins.includes(origin);
}

/**
 * @param {string} pathname
 */
function isRelayPath(pathname) {
  return (
    pathname.startsWith("/api/copilotkit") ||
    pathname === "/api/studio-llm-config"
  );
}

/**
 * @param {Request} request
 * @param {string[]} origins
 * @returns {string} echoed origin, or "" when this request must not see CORS
 */
function allowOrigin(request, origins) {
  const origin = request.headers.get("origin")?.trim() ?? "";
  if (origins.includes("*")) return origin || "*";
  if (origin && origins.includes(origin)) return origin;
  return "";
}

/**
 * @param {Request} request
 * @param {string[]} origins
 * @param {Response} response
 */
function withCors(request, origins, response) {
  const headers = new Headers(response.headers);
  const allowed = allowOrigin(request, origins);
  if (allowed) headers.set("Access-Control-Allow-Origin", allowed);
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
    const origins = parseCorsOrigins(env.COPILOT_CORS_ORIGIN, []);

    if (isRelayPath(url.pathname) && !originAllowed(request, origins)) {
      return new Response(JSON.stringify({ error: "origin not allowed" }), {
        status: 403,
        headers: {
          "Content-Type": "application/json",
          Vary: "Origin",
        },
      });
    }

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
