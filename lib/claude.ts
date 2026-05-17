import Anthropic from "@anthropic-ai/sdk";
import type { ConversationMessage } from "./types.js";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
const SYSTEM_PROMPT =
  process.env.BOT_SYSTEM_PROMPT ??
  "Você é um assistente útil e direto via WhatsApp. Responda em português, de forma curta e clara.";

const FALLBACK_REPLY = "Desculpe, não consegui gerar uma resposta agora. Pode tentar de novo?";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY env var");
  _client = new Anthropic({ apiKey });
  return _client;
}

export async function generateReply(
  history: ConversationMessage[],
  userMessage: string,
): Promise<string> {
  const messages = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: userMessage },
  ];

  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages,
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  return text || FALLBACK_REPLY;
}
