/**
 * CopilotKit Runtime for svg3dx Studio (local Node).
 *
 * Per-request LLM credentials come from browser headers (Settings → localStorage).
 * The server does not store user API keys.
 *
 * Optional server fallback (demo / local only):
 *   OPENAI_API_KEY / OPENAI_BASE_URL / COPILOT_MODEL
 *   or `.studio-llm.json` (legacy; no longer written by the UI)
 *
 * CORS: set COPILOT_CORS_ORIGIN to a comma-separated allowlist
 *   (e.g. https://www.dannyxu.net). Default `*` for local/dev.
 *
 *   npm run copilot
 * Hosted runtime: `npm run copilot:deploy` (Cloudflare Worker).
 */

import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";
import {
  HDR,
  createStudioRuntime,
  fallbackFromEnv,
  normalizeLlm,
} from "./copilot-shared.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(studioRoot, ".studio-llm.json");

/**
 * Optional server-side fallback — never written by the browser UI.
 * @returns {{ baseUrl: string, apiKey: string, model: string } | null}
 */
function readServerFallbackLlm() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      const cfg = normalizeLlm(raw.apiKey, raw.baseUrl, raw.model);
      if (cfg) return cfg;
    }
  } catch (err) {
    console.warn("[copilot-runtime] failed to read .studio-llm.json:", err);
  }

  return fallbackFromEnv(process.env);
}

const corsOriginEnv = String(process.env.COPILOT_CORS_ORIGIN ?? "*").trim();
const corsOrigins = corsOriginEnv
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 */
function applyCors(req, res) {
  const origin = req.headers.origin;
  let allow = "*";
  if (corsOrigins.includes("*")) {
    allow = origin || "*";
  } else if (origin && corsOrigins.includes(origin)) {
    allow = origin;
  } else if (corsOrigins[0]) {
    allow = corsOrigins[0];
  }
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Vary", "Origin");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );
  const requested = req.headers["access-control-request-headers"];
  res.setHeader(
    "Access-Control-Allow-Headers",
    typeof requested === "string" && requested.trim()
      ? requested
      : [
          "Content-Type",
          "Authorization",
          HDR.baseUrl,
          HDR.apiKey,
          HDR.model,
          HDR.userId,
        ].join(", ")
  );
}

const listenerOptions = {
  basePath: "/api/copilotkit",
  // Listener also emits CORS; we still apply for /api/studio-llm-config.
  cors: true,
};

const copilotListener = createCopilotNodeListener({
  ...listenerOptions,
  runtime: createStudioRuntime(readServerFallbackLlm),
});

const port = Number(process.env.COPILOT_PORT ?? process.env.PORT ?? 8200);

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (url.pathname === "/api/studio-llm-config") {
    if (req.method === "GET") {
      const fallback = readServerFallbackLlm();
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          mode: "per-request",
          /** Credentials are sent as request headers from the browser. */
          storesUserKeys: false,
          serverFallback: !!fallback,
          fallbackHint: fallback
            ? {
                baseUrl: fallback.baseUrl,
                model: fallback.model,
                apiKeyHint: `${fallback.apiKey.slice(0, 4)}…`,
              }
            : null,
        })
      );
      return;
    }
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        error:
          "LLM keys stay in the browser. Save them in Studio Settings; they are sent per request.",
      })
    );
    return;
  }

  if (url.pathname === "/api/health") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, service: "svg3dx-studio-copilot" }));
    return;
  }

  copilotListener(req, res);
}).listen(port, () => {
  const fallback = readServerFallbackLlm();
  console.log(
    `[copilot-runtime] http://127.0.0.1:${port}/api/copilotkit` +
      " (per-request LLM headers; keys not stored on server)"
  );
  console.log(
    `[copilot-runtime] CORS origins: ${corsOrigins.join(", ") || "*"}`
  );
  if (fallback) {
    console.log(
      `[copilot-runtime] server fallback ready: ${fallback.model} @ ${fallback.baseUrl}`
    );
  } else {
    console.log(
      "[copilot-runtime] no server fallback — clients must send Settings headers"
    );
  }
});
