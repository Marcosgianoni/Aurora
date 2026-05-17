import type { VercelRequest, VercelResponse } from "@vercel/node";
import { waitUntil } from "@vercel/functions";
import {
  extractMessages,
  sendTextMessage,
  type ParsedMessage,
} from "../lib/whatsapp.js";
import { generateReply } from "../lib/claude.js";
import {
  appendHistory,
  clearHistory,
  getHistory,
  markMessageProcessed,
} from "../lib/storage.js";

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? "";
const RESET_COMMANDS = new Set(["/reset", "/limpar", "/clear", "/esquecer"]);
const RESET_CONFIRMATION =
  "Memória limpa. Começamos do zero a partir de agora. Qual sua dúvida?";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  try {
    if (!isAuthorized(req)) {
      res.status(403).send("Forbidden");
      return;
    }

    if (req.method === "GET") {
      res.status(200).send("ok");
      return;
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      res.status(405).send("Method Not Allowed");
      return;
    }

    const payload = typeof req.body === "string"
      ? safeParse(req.body)
      : req.body;

    const messages = extractMessages(payload);
    waitUntil(processMessages(messages));

    res.status(200).send("ok");
  } catch (err) {
    console.error("Webhook handler crashed", err);
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).send(`Internal error: ${message}`);
  }
}

function safeParse(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function isAuthorized(req: VercelRequest): boolean {
  if (!WEBHOOK_SECRET) return false;

  const queryToken = typeof req.query.s === "string" ? req.query.s : undefined;
  if (queryToken && queryToken === WEBHOOK_SECRET) return true;

  const pathSecret = typeof req.query.secret === "string" ? req.query.secret : undefined;
  if (pathSecret && pathSecret === WEBHOOK_SECRET) return true;

  const urlPath = req.url ?? "";
  const segments = urlPath.split("?")[0]?.split("/").filter(Boolean) ?? [];
  const last = segments[segments.length - 1] ?? "";
  return last === WEBHOOK_SECRET;
}

async function processMessages(messages: ParsedMessage[]): Promise<void> {
  await Promise.all(
    messages.map(async (m) => {
      try {
        if (m.data.isGroup) return;

        const isNew = await markMessageProcessed(m.data.messageId);
        if (!isNew) return;

        if (m.kind === "unsupported") {
          await sendTextMessage(
            m.data.from,
            "No momento só consigo processar mensagens de texto. Pode escrever sua dúvida?",
          );
          return;
        }

        if (RESET_COMMANDS.has(m.data.text.trim().toLowerCase())) {
          await clearHistory(m.data.from);
          await sendTextMessage(m.data.from, RESET_CONFIRMATION);
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
