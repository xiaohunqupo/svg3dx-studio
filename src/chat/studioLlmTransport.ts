/**
 * Browser → Copilot Runtime transport for per-request LLM credentials.
 * Header names must stay in sync with `scripts/copilot-runtime.mjs`.
 */

export const STUDIO_LLM_HEADERS = {
  baseUrl: "x-studio-llm-base-url",
  apiKey: "x-studio-llm-api-key",
  model: "x-studio-llm-model",
  userId: "x-studio-user-id",
} as const;

export type StudioLlmCredentials = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

/** Headers attached to every CopilotKit runtime request. */
export function buildStudioLlmHeaders(
  llm: StudioLlmCredentials,
  userId: string
): Record<string, string> {
  const headers: Record<string, string> = {};
  const baseUrl = llm.baseUrl.trim().replace(/\/$/, "");
  const apiKey = llm.apiKey.trim();
  const model = llm.model.trim();
  if (baseUrl) headers[STUDIO_LLM_HEADERS.baseUrl] = baseUrl;
  if (apiKey) headers[STUDIO_LLM_HEADERS.apiKey] = apiKey;
  if (model) headers[STUDIO_LLM_HEADERS.model] = model;
  const uid = userId.trim();
  if (uid) headers[STUDIO_LLM_HEADERS.userId] = uid;
  return headers;
}
