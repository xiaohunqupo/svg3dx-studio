/**
 * Shared CopilotKit runtime setup for the local Node server and the
 * Cloudflare Worker. No filesystem or Node HTTP — credentials come from
 * request headers, with an optional fallback supplied by the host.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { BuiltInAgent, CopilotRuntime } from "@copilotkit/runtime/v2";

/** Must match `src/chat/studioLlmTransport.ts`. */
export const HDR = {
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

const MISSING_LLM =
  "Missing LLM credentials. Configure the assistant in Studio Settings, " +
  "or set OPENAI_API_KEY on the Runtime host.";

/**
 * @param {string} apiKey
 * @param {string} baseUrl
 * @param {string} model
 * @returns {{ baseUrl: string, apiKey: string, model: string } | null}
 */
export function normalizeLlm(apiKey, baseUrl, model) {
  const key = String(apiKey ?? "").trim();
  const url = String(baseUrl ?? "").trim().replace(/\/$/, "");
  const mod = String(model ?? "").trim();
  if (!key || PLACEHOLDER_KEYS.has(key.toLowerCase()) || !url || !mod) {
    return null;
  }
  return { apiKey: key, baseUrl: url, model: mod };
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ baseUrl: string, apiKey: string, model: string } | null}
 */
export function fallbackFromEnv(env) {
  return normalizeLlm(
    env?.OPENAI_API_KEY,
    env?.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    env?.COPILOT_MODEL ?? env?.STUDIO_CHAT_MODEL ?? "gpt-4o-mini"
  );
}

/**
 * @param {Request} request
 * @returns {{ baseUrl: string, apiKey: string, model: string } | null}
 */
export function llmFromRequest(request) {
  return normalizeLlm(
    request.headers.get(HDR.apiKey),
    request.headers.get(HDR.baseUrl),
    request.headers.get(HDR.model)
  );
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

/**
 * @param {() => { baseUrl: string, apiKey: string, model: string } | null} [readFallback]
 */
export function createStudioRuntime(readFallback) {
  return new CopilotRuntime({
    // Per-browser identity via x-studio-user-id — isolates threads without login.
    identifyUser: (request) => {
      const id =
        request.headers.get(HDR.userId)?.trim() ||
        request.headers.get("cf-connecting-ip")?.trim() ||
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        "anonymous";
      return { id };
    },
    agents: ({ request }) => {
      const cfg = llmFromRequest(request) ?? readFallback?.() ?? null;
      if (!cfg) throw new Error(MISSING_LLM);
      return { default: createAgent(cfg) };
    },
  });
}

/**
 * @param {string | undefined} raw
 * @param {string[]} defaults
 */
export function parseCorsOrigins(raw, defaults) {
  const value = String(raw ?? "").trim();
  if (!value) return defaults;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {string[]} origins
 * @returns {true | { origin: string[] }}
 */
export function copilotCors(origins) {
  if (origins.includes("*")) return true;
  return { origin: origins };
}
