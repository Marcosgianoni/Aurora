import crypto from "node:crypto";

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN ?? "";
const APP_SECRET = process.env.WHATSAPP_APP_SECRET ?? "";
const GRAPH_API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION ?? "v21.0";

const messagesUrl = () =>
  `https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}/messages`;

export async function sendTextMessage(to: string, body: string): Promise<void> {
  const res = await fetch(messagesUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WhatsApp send failed (${res.status}): ${errText}`);
  }
}

export async function markAsRead(messageId: string): Promise<void> {
  await fetch(messagesUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    }),
  });
}

export function verifySignature(rawBody: string, signatureHeader: string | undefined): boolean {
  if (!APP_SECRET) return false;
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;

  const expected = crypto
    .createHmac("sha256", APP_SECRET)
    .update(rawBody)
    .digest("hex");
  const provided = signatureHeader.slice("sha256=".length);

  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

export interface ParsedTextMessage {
  from: string;
  messageId: string;
  text: string;
  timestamp: number;
}

export interface ParsedUnsupportedMessage {
  from: string;
  messageId: string;
  type: string;
  timestamp: number;
}

export type ParsedMessage =
  | { kind: "text"; data: ParsedTextMessage }
  | { kind: "unsupported"; data: ParsedUnsupportedMessage };

interface WhatsAppMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body?: string };
}

interface WhatsAppPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: WhatsAppMessage[];
      };
    }>;
  }>;
}

export function extractMessages(payload: unknown): ParsedMessage[] {
  const result: ParsedMessage[] = [];
  const entries = (payload as WhatsAppPayload)?.entry ?? [];

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      for (const m of change.value?.messages ?? []) {
        const base = {
          from: m.from,
          messageId: m.id,
          timestamp: Number(m.timestamp) * 1000,
        };
        if (m.type === "text" && m.text?.body) {
          result.push({ kind: "text", data: { ...base, text: m.text.body } });
        } else {
          result.push({ kind: "unsupported", data: { ...base, type: m.type } });
        }
      }
    }
  }
  return result;
}
