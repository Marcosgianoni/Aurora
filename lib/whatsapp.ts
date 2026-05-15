const API_BASE_URL = process.env.ZAPPFY_API_BASE_URL ?? "https://api.zappfy.io";
const INSTANCE_TOKEN = process.env.ZAPPFY_INSTANCE_TOKEN ?? "";

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    token: INSTANCE_TOKEN,
  };
}

export async function sendTextMessage(numberE164: string, text: string): Promise<void> {
  const url = `${API_BASE_URL}/send/text`;
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      number: numberE164,
      text,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Zappfy send failed (${res.status}): ${errText}`);
  }
}

export interface ParsedTextMessage {
  from: string;
  messageId: string;
  text: string;
  timestamp: number;
  isGroup: boolean;
}

export interface ParsedUnsupportedMessage {
  from: string;
  messageId: string;
  type: string;
  timestamp: number;
  isGroup: boolean;
}

export type ParsedMessage =
  | { kind: "text"; data: ParsedTextMessage }
  | { kind: "unsupported"; data: ParsedUnsupportedMessage };

const WA_JID_SUFFIX = /@(?:s\.whatsapp\.net|g\.us|c\.us|lid)$/;

function stripJidSuffix(value: string): string {
  return value.replace(WA_JID_SUFFIX, "");
}

export function extractMessages(payload: unknown): ParsedMessage[] {
  const candidates = collectMessageCandidates(payload);
  const result: ParsedMessage[] = [];

  for (const m of candidates) {
    if (m.fromMe || m.wasSentByApi) continue;
    if (!m.from || !m.messageId) continue;

    const base = {
      from: m.from,
      messageId: m.messageId,
      timestamp: m.timestamp,
      isGroup: m.isGroup,
    };

    if (m.text) {
      result.push({ kind: "text", data: { ...base, text: m.text } });
    } else {
      result.push({ kind: "unsupported", data: { ...base, type: m.type ?? "unknown" } });
    }
  }

  return result;
}

interface NormalizedMessage {
  from: string;
  messageId: string;
  text?: string;
  type?: string;
  timestamp: number;
  fromMe: boolean;
  wasSentByApi: boolean;
  isGroup: boolean;
}

function collectMessageCandidates(payload: unknown): NormalizedMessage[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;

  if (Array.isArray(p.messages)) {
    return p.messages
      .map(normalizeMessage)
      .filter((m): m is NormalizedMessage => m !== null);
  }

  if (p.data) {
    if (Array.isArray(p.data)) {
      return (p.data as unknown[])
        .map(normalizeMessage)
        .filter((m): m is NormalizedMessage => m !== null);
    }
    const single = normalizeMessage(p.data);
    return single ? [single] : [];
  }

  const single = normalizeMessage(p);
  return single ? [single] : [];
}

function normalizeMessage(raw: unknown): NormalizedMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, any>;

  const fromRaw =
    (typeof m.chatid === "string" && m.chatid) ||
    (typeof m.sender === "string" && m.sender) ||
    (typeof m.from === "string" && m.from) ||
    (typeof m.phone === "string" && m.phone) ||
    (typeof m.remoteJid === "string" && m.remoteJid) ||
    (m.key && typeof m.key.remoteJid === "string" && m.key.remoteJid) ||
    "";

  const messageId =
    (typeof m.messageid === "string" && m.messageid) ||
    (typeof m.messageId === "string" && m.messageId) ||
    (typeof m.id === "string" && m.id) ||
    (m.key && typeof m.key.id === "string" && m.key.id) ||
    "";

  const text =
    (typeof m.text === "string" && m.text) ||
    (m.content && typeof m.content.text === "string" && m.content.text) ||
    (typeof m.body === "string" && m.body) ||
    (m.message && typeof m.message.conversation === "string" && m.message.conversation) ||
    (m.message?.extendedTextMessage &&
      typeof m.message.extendedTextMessage.text === "string" &&
      m.message.extendedTextMessage.text) ||
    undefined;

  const type =
    (typeof m.messageType === "string" && m.messageType) ||
    (typeof m.type === "string" && m.type) ||
    (m.message && Object.keys(m.message)[0]) ||
    undefined;

  const tsRaw =
    (typeof m.messageTimestamp === "number" && m.messageTimestamp) ||
    (typeof m.timestamp === "number" && m.timestamp) ||
    (typeof m.timestamp === "string" && Number(m.timestamp)) ||
    (typeof m.t === "number" && m.t) ||
    Date.now();
  const timestamp = tsRaw > 1e12 ? tsRaw : tsRaw * 1000;

  const fromMe = Boolean(m.fromMe ?? m.key?.fromMe ?? false);
  const wasSentByApi = Boolean(m.wasSentByApi ?? false);

  const fromJid = String(fromRaw);
  const isGroup = Boolean(m.isGroup ?? fromJid.endsWith("@g.us"));
  const from = stripJidSuffix(fromJid).replace(/:\d+$/, "");

  return {
    from,
    messageId: String(messageId),
    text: text ? String(text) : undefined,
    type,
    timestamp,
    fromMe,
    wasSentByApi,
    isGroup,
  };
}
