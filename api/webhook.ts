import { waitUntil } from "@vercel/functions";
import {
  extractMessages,
  markAsRead,
  sendTextMessage,
  verifySignature,
  type ParsedMessage,
} from "../lib/whatsapp.js";
import { generateReply } from "../lib/claude.js";
import {
  appendHistory,
  getHistory,
  markMessageProcessed,
} from "../lib/storage.js";

export const config = {
  runtime: "nodejs",
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge") ?? "";
    if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, POST" },
    });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256") ?? undefined;
  if (!verifySignature(rawBody, signature)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const messages = extractMessages(payload);
  waitUntil(processMessages(messages));

  return new Response("ok", { status: 200 });
}

async function processMessages(messages: ParsedMessage[]): Promise<void> {
  await Promise.all(
    messages.map(async (m) => {
      try {
        const isNew = await markMessageProcessed(m.data.messageId);
        if (!isNew) return;

        await markAsRead(m.data.messageId).catch(() => undefined);

        if (m.kind === "unsupported") {
          await sendTextMessage(
            m.data.from,
            "No momento só consigo processar mensagens de texto. Pode escrever sua dúvida?",
          );
          return;
        }

        const history = await getHistory(m.data.from);
        const reply = await generateReply(history, m.data.text);

        await sendTextMessage(m.data.from, reply);

        await appendHistory(m.data.from, {
          role: "user",
          content: m.data.text,
          timestamp: m.data.timestamp,
        });
        await appendHistory(m.data.from, {
          role: "assistant",
          content: reply,
          timestamp: Date.now(),
        });
      } catch (err) {
        console.error("Failed to process message", m.data.messageId, err);
      }
    }),
  );
}
