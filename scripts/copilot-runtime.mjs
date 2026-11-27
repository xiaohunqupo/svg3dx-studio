/**
 * CopilotKit Runtime for svg3dx Studio.
 *
 * Per-request LLM credentials come from browser headers (Settings → localStorage).
 * The server does not store user API keys.
 *
 * Optional server fallback (demo / local only):
 *   OPENAI_API_KEY / OPENAI_BASE_URL / COPILOT_MODEL
 *   or `.studio-llm.json` (legacy; no longer written by the UI)
 *
 * CORS: set COPILOT_CORS_ORIGIN to a comma-separated allowlist
 *   (e.g. https://xiaohunqupo.github.io). Default `*` for local/dev.
 *
 *   npm run copilot
 */

import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { BuiltInAgent, CopilotRuntime } from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(studioRoot, ".studio-llm.json");

/** Must match `src/chat/studioLlmTransport.ts`. */
const HDR = {
  baseUrl: "x-studio-llm-base-url",
  apiKey: "x-studio-llm-api-key",
  model: "x-studio-llm-model",
  userId: "x-studio-user-id",
};

const PLACEHOLDER_KEYS = new Set([
  "",
  "sk-your-key-here",
  "your-key-here",
  "changeme",
]);

const STUDIO_PROMPT = [
  "You are the svg3dx Studio assistant inside a 3D SVG (.svg3dx) editor.",
  "Be concise; prefer tools over guessing; use markdown when useful.",
  "CRITICAL: When context.page is \"edit\" (or edit snapshot is present), work ONLY on that active document.",
  "Do NOT call list_files, go_edit, go_browse, rename_file, or remove_file for content edits — those are for switching/managing files when the user asks.",
  "Edit workflow: get_source / get_selection on the current doc → change via replace_in_source, update_node_attrs, add_*, insert_at_path, delete_at_path → save_document if the user wants persistence.",
  "Use get_edit_state only if you need selection/panel/undo info not already in context. Prefer replace_in_source over set_source for partial edits.",
  "Other tools: format_document, optimize_document, export_document, export_package, set_panel, undo, redo, select_node, read_node_attrs,",
  "add_group, add_model, add_material, add_root_animate, add_style_category, add_child, add_use.",
  "Tree paths: model:main, model:main.g1, material:mat1, style:.foo, defs:…. Empty attr values remove attributes. gltf inserts need href.",
  "Attachments: analyze images/documents when the user provides them.",
].join(" ");

/**
 * @param {string} apiKey
 * @param {string} baseUrl
 * @param {string} model
 * @returns {{ baseUrl: string, apiKey: string, model: string } | null}
 */
function normalizeLlm(apiKey, baseUrl, model) {
  const key = String(apiKey ?? "").trim();
  const url = String(baseUrl ?? "").trim().replace(/\/$/, "");
  const mod = String(model ?? "").trim();
  if (!key || PLACEHOLDER_KEYS.has(key.toLowerCase()) || !url || !mod) {
    return null;
  }
  return { apiKey: key, baseUrl: url, model: mod };
}

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

  return normalizeLlm(
    process.env.OPENAI_API_KEY,
    process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    process.env.COPILOT_MODEL ?? process.env.STUDIO_CHAT_MODEL ?? "gpt-4o-mini"
  );
}

/**
 * @param {Request} request
 * @returns {{ baseUrl: string, apiKey: string, model: string } | null}
 */
function llmFromRequest(request) {
  const fromHeaders = normalizeLlm(
    request.headers.get(HDR.apiKey),
    request.headers.get(HDR.baseUrl),
    request.headers.get(HDR.model)
  );
  return fromHeaders ?? readServerFallbackLlm();
}

/**
 * @param {string} baseUrl
 */
function isOfficialOpenAIHost(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname;
    return host === "api.openai.com" || host.endsWith(".api.openai.com");
  } catch {
    return false;
  }
}

/**
 * @param {{ baseUrl: string, apiKey: string, model: string }} cfg
 */
function resolveAgentModel(cfg) {
  const modelId = cfg.model || "gpt-4o-mini";
  if (!isOfficialOpenAIHost(cfg.baseUrl)) {
    const provider = createOpenAICompatible({
      name: "studio-llm",
      baseURL: cfg.baseUrl,
      apiKey: cfg.apiKey,
      includeUsage: true,
    });
    return provider.chatModel(modelId);
  }
  if (modelId.includes(":") || modelId.includes("/")) return modelId;
  return `openai/${modelId}`;
}

/**
 * @param {{ baseUrl: string, apiKey: string, model: string }} cfg
 */
function createAgent(cfg) {
  return new BuiltInAgent({
    model: resolveAgentModel(cfg),
    apiKey: cfg.apiKey,
    prompt: STUDIO_PROMPT,
  });
}

function createRuntime() {
  return new CopilotRuntime({
    // Per-browser identity via x-studio-user-id — isolates threads without login.
    identifyUser: (request) => {
      const id =
        request.headers.get(HDR.userId)?.trim() ||
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        "anonymous";
      return { id };
    },
    agents: ({ request }) => {
      const cfg = llmFromRequest(request);
      if (!cfg) {
        throw new Error(
          "Missing LLM credentials. Configure the assistant in Studio Settings, " +
            "or set OPENAI_API_KEY on the Runtime host."
        );
      }
      return { default: createAgent(cfg) };
    },
  });
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
  runtime: createRuntime(),
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
