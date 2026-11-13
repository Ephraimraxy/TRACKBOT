import type {
  ChatMessage,
  ChatProvider,
  ProviderId,
  ProviderReply,
  ToolCall,
  ToolSpec,
} from "@/lib/chatbot/types";

type FetchLike = typeof fetch;

interface Config {
  apiKey: string;
  model: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TOKENS = 500;

/** Keys that are obviously not real (so a copied .env.example never triggers calls). */
const PLACEHOLDER = /^(|your[-_].*|changeme.*|xxx+|dummy.*|placeholder.*|sk-\.\.\.)$/i;
export const isUsableKey = (key: string | undefined): key is string =>
  typeof key === "string" && !PLACEHOLDER.test(key.trim());

function parseArgs(raw: unknown): unknown {
  if (typeof raw !== "string") return raw ?? {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function postJson(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number
): Promise<unknown> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  // Only the status is reported: response bodies could echo request data.
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* -------------------------------------------------------------------------- */
/* DeepSeek and OpenAI share the same chat-completions wire format.            */
/* -------------------------------------------------------------------------- */

function openAiMessages(system: string, messages: ChatMessage[]) {
  const out: unknown[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.content ?? null,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: "function",
                function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
              })),
            }
          : {}),
      });
    } else {
      out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    }
  }
  return out;
}

function openAiCompatible(
  id: ProviderId,
  baseUrl: string,
  { apiKey, model, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }: Config
): ChatProvider {
  return {
    id,
    async complete({ system, messages, tools }): Promise<ProviderReply> {
      const json = (await postJson(
        fetchImpl,
        baseUrl,
        { authorization: `Bearer ${apiKey}` },
        {
          model,
          messages: openAiMessages(system, messages),
          tools: tools.map((t: ToolSpec) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
          tool_choice: "auto",
          temperature: 0.2,
          max_tokens: MAX_TOKENS,
        },
        timeoutMs
      )) as {
        choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
      };

      const msg = json.choices?.[0]?.message;
      if (!msg) throw new Error("empty response");
      const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((c) => ({
        id: c.id,
        name: c.function.name,
        args: parseArgs(c.function.arguments),
      }));
      return { text: msg.content ?? undefined, toolCalls };
    },
  };
}

export const deepseekProvider = (cfg: Config) =>
  openAiCompatible("deepseek", "https://api.deepseek.com/chat/completions", cfg);

export const openaiProvider = (cfg: Config) =>
  openAiCompatible("openai", "https://api.openai.com/v1/chat/completions", cfg);

/* -------------------------------------------------------------------------- */
/* Anthropic (Claude) Messages API.                                            */
/* -------------------------------------------------------------------------- */

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

function anthropicMessages(messages: ChatMessage[]) {
  const out: { role: "user" | "assistant"; content: string | AnthropicBlock[] }[] = [];
  for (const m of messages) {
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      const blocks: AnthropicBlock[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const c of m.toolCalls ?? []) {
        blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.args ?? {} });
      }
      out.push({ role: "assistant", content: blocks.length ? blocks : "" });
    } else {
      // Consecutive tool results must live in ONE user message.
      const block: AnthropicBlock = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content) && last.content.every((b) => b.type === "tool_result")) {
        last.content.push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    }
  }
  return out;
}

export function anthropicProvider({
  apiKey,
  model,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: Config): ChatProvider {
  return {
    id: "anthropic",
    async complete({ system, messages, tools }): Promise<ProviderReply> {
      const json = (await postJson(
        fetchImpl,
        "https://api.anthropic.com/v1/messages",
        { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        {
          model,
          max_tokens: MAX_TOKENS,
          temperature: 0.2,
          system,
          tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
          messages: anthropicMessages(messages),
        },
        timeoutMs
      )) as { content?: AnthropicBlock[] };

      if (!Array.isArray(json.content)) throw new Error("empty response");
      const text = json.content
        .filter((b): b is Extract<AnthropicBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      const toolCalls: ToolCall[] = json.content
        .filter((b): b is Extract<AnthropicBlock, { type: "tool_use" }> => b.type === "tool_use")
        .map((b) => ({ id: b.id, name: b.name, args: b.input }));
      return { text: text || undefined, toolCalls };
    },
  };
}

/**
 * Providers in priority order: DeepSeek, then OpenAI, then Claude.
 * A provider is included only when its API key is set to something real.
 */
export function buildProviders(
  env: Record<string, string | undefined> = process.env,
  fetchImpl?: FetchLike
): ChatProvider[] {
  const timeoutMs = Number(env.CHAT_PROVIDER_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const providers: ChatProvider[] = [];
  if (isUsableKey(env.DEEPSEEK_API_KEY)) {
    providers.push(deepseekProvider({ apiKey: env.DEEPSEEK_API_KEY, model: env.DEEPSEEK_MODEL || "deepseek-chat", fetchImpl, timeoutMs }));
  }
  if (isUsableKey(env.OPENAI_API_KEY)) {
    providers.push(openaiProvider({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL || "gpt-4o-mini", fetchImpl, timeoutMs }));
  }
  if (isUsableKey(env.ANTHROPIC_API_KEY)) {
    providers.push(anthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || "claude-haiku-5-5", fetchImpl, timeoutMs }));
  }
  return providers;
}
