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
 * @param {{ baseUrl: string, apiKey: string, model: string } | null} cfg
 */
function applyEnvFromConfig(cfg) {
  if (!cfg) return;
  process.env.OPENAI_API_KEY = cfg.apiKey;
  process.env.OPENAI_BASE_URL = cfg.baseUrl;
  const host = (() => {
    try {
      return new URL(cfg.baseUrl).hostname;
    } catch {
      return "";
    }
  })();
  const isOfficialOpenAI =
    host === "api.openai.com" || host.endsWith(".api.openai.com");
  if (!isOfficialOpenAI) {
    process.env.COPILOTKIT_OPENAI_API = "chat";
  }
}

function createRuntime() {
  const cfg = readLlmConfig();
  applyEnvFromConfig(cfg);
  const modelId = cfg?.model || "gpt-4o-mini";
  const model = modelId.includes(":") ? modelId : `openai:${modelId}`;

  return new CopilotRuntime({
    // Local single-user Studio — share threads without identity.
    threads: { access: "open" },
    agents: {
      default: new BuiltInAgent({
        model,
        apiKey: cfg?.apiKey,
        prompt: [
          "You are the svg3dx Studio assistant inside a 3D SVG (.svg3dx) editor.",
          "Help the user browse and edit documents. Be concise; use markdown when useful.",
          "Prefer tools over guessing. Call get_edit_state before edits when unsure.",
          "Navigation/files: list_files, go_browse, go_edit, rename_file, remove_file.",
          "Source: get_source (use maxChars/offset for large docs), replace_in_source for surgical edits, set_source only for full rewrites.",
          "Menus: save_document, undo, redo, format_document, optimize_document, export_document, export_package, set_panel.",
          "Selection/nodes: get_selection, select_node, read_node_attrs, update_node_attrs,",
          "add_group, add_model, add_material, add_root_animate, add_style_category, add_child, add_use, insert_at_path, delete_at_path.",
          "Tree paths look like model:main, model:main.g1, material:mat1, style:.foo, defs:…. Empty attr values remove attributes.",
          "gltf inserts require an href. Edit tools only work after go_edit.",
          "You may receive images or documents as attachments — analyze them when present.",
        ].join(" "),
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
  console.log(
    `[copilot-runtime] http://127.0.0.1:${port}/api/copilotkit` +
      (cfg
        ? ` (${cfg.model} @ ${cfg.baseUrl})`
        : " — waiting for Settings / OPENAI_API_KEY")
  );
});
