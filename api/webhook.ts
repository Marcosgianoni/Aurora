import { waitUntil } from "@vercel/functions";
import {
  extractMessages,
  sendTextMessage,
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

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? "";

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (!isAuthorized(url)) {
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method === "GET") {
    // Endpoint de saúde / verificação manual
    return new Response("ok", { status: 200 });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, POST" },
    });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const messages = extractMessages(payload);
  waitUntil(processMessages(messages));

  return new Response("ok", { status: 200 });
}

function isAuthorized(url: URL): boolean {
  if (!WEBHOOK_SECRET) return false;
  // Aceita o secret em query (?s=...) ou no último segmento do path
  // (ex: /api/webhook/<secret>)
  const queryToken = url.searchParams.get("s");
  if (queryToken && queryToken === WEBHOOK_SECRET) return true;

  const segments = url.pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  return last === WEBHOOK_SECRET;
}

async function processMessages(messages: ParsedMessage[]): Promise<void> {
  await Promise.all(
    messages.map(async (m) => {
      try {
        if (m.data.isGroup) return; // Ignora grupos por padrão

        const isNew = await markMessageProcessed(m.data.messageId);
        if (!isNew) return;

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
