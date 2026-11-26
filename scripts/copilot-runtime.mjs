/**
 * CopilotKit Runtime for svg3dx Studio.
 *
 * LLM settings: `/.studio-llm.json` (from Settings UI via PUT /api/studio-llm-config)
 * or OPENAI_API_KEY / OPENAI_BASE_URL / COPILOT_MODEL env vars.
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
 * @returns {{ baseUrl: string, apiKey: string, model: string } | null}
 */
function readLlmConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      const apiKey = String(raw.apiKey ?? "").trim();
      const baseUrl = String(raw.baseUrl ?? "").trim().replace(/\/$/, "");
      const model = String(raw.model ?? "").trim();
      if (
        apiKey &&
        !PLACEHOLDER_KEYS.has(apiKey.toLowerCase()) &&
        baseUrl &&
        model
      ) {
        return { apiKey, baseUrl, model };
      }
    }
  } catch (err) {
    console.warn("[copilot-runtime] failed to read .studio-llm.json:", err);
  }

  const apiKey = String(process.env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey || PLACEHOLDER_KEYS.has(apiKey.toLowerCase())) return null;
  return {
    apiKey,
    baseUrl: String(process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1")
      .trim()
      .replace(/\/$/, ""),
    model: String(
      process.env.COPILOT_MODEL ?? process.env.STUDIO_CHAT_MODEL ?? "gpt-4o-mini"
    ).trim(),
  };
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
 * @param {{ baseUrl: string, apiKey: string, model: string } | null} cfg
 */
function applyEnvFromConfig(cfg) {
  if (!cfg) return;
  process.env.OPENAI_API_KEY = cfg.apiKey;
  process.env.OPENAI_BASE_URL = cfg.baseUrl;
  // Official OpenAI keeps Responses (reasoning summaries). Compatible hosts
  // no longer need this override — they use @ai-sdk/openai-compatible below.
  if (!isOfficialOpenAIHost(cfg.baseUrl)) {
    delete process.env.COPILOTKIT_OPENAI_API;
  }
}

/**
 * Resolve the BuiltInAgent model.
 * Compatible endpoints (DeepSeek, etc.) use @ai-sdk/openai-compatible so
 * `reasoning_content` streams become CopilotKit reasoning messages.
 * Official OpenAI keeps string specs for the Responses API.
 *
 * @param {{ baseUrl: string, apiKey: string, model: string } | null} cfg
 */
function resolveAgentModel(cfg) {
  const modelId = cfg?.model || "gpt-4o-mini";
  if (cfg && !isOfficialOpenAIHost(cfg.baseUrl)) {
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

function createRuntime() {
  const cfg = readLlmConfig();
  applyEnvFromConfig(cfg);
  const model = resolveAgentModel(cfg);

  return new CopilotRuntime({
    // Local single-user Studio — share threads without identity.
    threads: { access: "open" },
    agents: {
      default: new BuiltInAgent({
        model,
        apiKey: cfg?.apiKey,
        prompt: STUDIO_PROMPT,
      }),
    },
  });
}

const listenerOptions = {
  basePath: "/api/copilotkit",
  cors: true,
};

/** @type {ReturnType<typeof createCopilotNodeListener>} */
let copilotListener = createCopilotNodeListener({
  ...listenerOptions,
  runtime: createRuntime(),
});

function reloadRuntime() {
  copilotListener = createCopilotNodeListener({
    ...listenerOptions,
    runtime: createRuntime(),
  });
}

const port = Number(process.env.COPILOT_PORT ?? process.env.PORT ?? 8200);

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

  if (url.pathname === "/api/studio-llm-config") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method === "GET") {
      const cfg = readLlmConfig();
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify(
          cfg
            ? {
                configured: true,
                baseUrl: cfg.baseUrl,
                model: cfg.model,
                apiKeyHint: cfg.apiKey ? `${cfg.apiKey.slice(0, 4)}…` : "",
              }
            : { configured: false }
        )
      );
      return;
    }
    if (req.method === "DELETE") {
      try {
        if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
        reloadRuntime();
        console.log("[copilot-runtime] LLM config cleared");
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, cleared: true }));
      } catch (err) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          })
        );
      }
      return;
    }
    if (req.method === "PUT") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        try {
          const body = JSON.parse(
            Buffer.concat(chunks).toString("utf8") || "{}"
          );
          const next = {
            baseUrl: String(body.baseUrl ?? "").trim().replace(/\/$/, ""),
            apiKey: String(body.apiKey ?? "").trim(),
            model: String(body.model ?? "").trim(),
          };
          if (!next.baseUrl || !next.apiKey || !next.model) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                error: "baseUrl, apiKey, and model are required",
              })
            );
            return;
          }
          fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), "utf8");
          reloadRuntime();
          console.log(
            `[copilot-runtime] LLM config updated → ${next.model} @ ${next.baseUrl}`
          );
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : String(err),
            })
          );
        }
      });
      return;
    }
    res.statusCode = 405;
    res.end("Method not allowed");
    return;
  }

  copilotListener(req, res);
}).listen(port, () => {
  const cfg = readLlmConfig();
  const via =
    cfg && !isOfficialOpenAIHost(cfg.baseUrl)
      ? "openai-compatible+reasoning"
      : cfg
        ? "openai"
        : null;
  console.log(
    `[copilot-runtime] http://127.0.0.1:${port}/api/copilotkit` +
      (cfg
        ? ` (${cfg.model} @ ${cfg.baseUrl}, ${via})`
        : " — waiting for Settings / OPENAI_API_KEY")
  );
});
