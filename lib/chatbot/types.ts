import type { UserRole } from "@prisma/client";

/** Who is chatting. Comes from the server session, never from the model or the request body. */
export interface ChatContext {
  userId: string | null;
  role: UserRole | null;
}

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

/** Provider-neutral conversation format (each provider adapter converts it). */
export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content?: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
}

export interface ProviderReply {
  text?: string;
  toolCalls?: ToolCall[];
}

export type ProviderId = "deepseek" | "openai" | "anthropic";

export interface ChatProvider {
  id: ProviderId;
  complete(args: {
    system: string;
    messages: ChatMessage[];
    tools: ToolSpec[];
  }): Promise<ProviderReply>;
}

export interface ChatResult {
  reply: string;
  /** Which provider produced the reply, or "rules" for the built-in fallback. */
  source: ProviderId | "rules";
  usedTools: string[];
  /** Why earlier providers were skipped (for server logs only, never sent to the client). */
  skipped: string[];
}
