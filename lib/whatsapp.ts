const API_BASE_URL = process.env.ZAPPFY_API_BASE_URL ?? "https://api.zappfy.io";
const INSTANCE_TOKEN = process.env.ZAPPFY_INSTANCE_TOKEN ?? "";

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    token: INSTANCE_TOKEN,
  };
}

// TODO_ZAPPFY: confirmar endpoint e body de envio de texto.
// Suposição baseada no padrão Baileys/Z-API + na doc Zappfy que menciona o
// campo "number" no body. Quando confirmar a página "Enviar Mensagem → Enviar
// Texto", ajuste path/body aqui se necessário.
const SEND_TEXT_PATH = "/message/sendText";

export async function sendTextMessage(numberE164: string, message: string): Promise<void> {
  const url = `${API_BASE_URL}${SEND_TEXT_PATH}`;
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      number: numberE164,
      message,
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

// TODO_ZAPPFY: confirmar o shape do payload do evento "messages".
// O parser abaixo é tolerante e cobre as variações mais comuns em providers
// baseados em Baileys (Zappfy é Baileys-based):
//   - { event, data: { ... } } com data sendo a mensagem
//   - { messages: [ ... ] } estilo Z-API
//   - { type, data: { ... } }
// Cobrimos os campos prováveis: chatid/from/phone, fromMe/wasSentByApi,
// messageId/id, message.conversation / text / body, type / messageType,
// isGroup, t/timestamp.
export function extractMessages(payload: unknown): ParsedMessage[] {
  const candidates = collectMessageCandidates(payload);
  const result: ParsedMessage[] = [];

  for (const m of candidates) {
    if (m.fromMe || m.wasSentByApi) continue;

    const base = {
      from: m.from,
      messageId: m.messageId,
      timestamp: m.timestamp,
      isGroup: m.isGroup,
    };

    if (!base.from || !base.messageId) continue;

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

  // Padrão 1: array em "messages"
  if (Array.isArray(p.messages)) {
    return p.messages
      .map(normalizeMessage)
      .filter((m): m is NormalizedMessage => m !== null);
  }

  // Padrão 2: { event, data: ... } — data pode ser objeto único ou array
  if (p.data) {
    if (Array.isArray(p.data)) {
      return (p.data as unknown[])
        .map(normalizeMessage)
        .filter((m): m is NormalizedMessage => m !== null);
    }
    const single = normalizeMessage(p.data);
    return single ? [single] : [];
  }

  // Padrão 3: payload já é a mensagem
  const single = normalizeMessage(p);
  return single ? [single] : [];
}

function normalizeMessage(raw: unknown): NormalizedMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, any>;

  const from =
    (typeof m.chatid === "string" && m.chatid) ||
    (typeof m.from === "string" && m.from) ||
    (typeof m.phone === "string" && m.phone) ||
    (typeof m.remoteJid === "string" && m.remoteJid) ||
    (m.key && typeof m.key.remoteJid === "string" && m.key.remoteJid) ||
    "";

  const messageId =
    (typeof m.messageId === "string" && m.messageId) ||
    (typeof m.id === "string" && m.id) ||
    (m.key && typeof m.key.id === "string" && m.key.id) ||
    "";

  const text =
    (typeof m.text === "string" && m.text) ||
    (typeof m.body === "string" && m.body) ||
    (m.text && typeof m.text.message === "string" && m.text.message) ||
    (m.message && typeof m.message.conversation === "string" && m.message.conversation) ||
    (m.message?.extendedTextMessage &&
      typeof m.message.extendedTextMessage.text === "string" &&
      m.message.extendedTextMessage.text) ||
    undefined;

  const type =
    (typeof m.type === "string" && m.type) ||
    (typeof m.messageType === "string" && m.messageType) ||
    (m.message && Object.keys(m.message)[0]) ||
    undefined;

  const tsRaw =
    (typeof m.timestamp === "number" && m.timestamp) ||
    (typeof m.timestamp === "string" && Number(m.timestamp)) ||
    (typeof m.t === "number" && m.t) ||
    (typeof m.messageTimestamp === "number" && m.messageTimestamp) ||
    Date.now() / 1000;
  const timestamp = tsRaw > 1e12 ? tsRaw : tsRaw * 1000;

  const fromMe = Boolean(m.fromMe ?? m.key?.fromMe ?? false);
  const wasSentByApi = Boolean(m.wasSentByApi ?? false);
  const isGroup = Boolean(
    m.isGroup ?? (typeof from === "string" && from.endsWith("@g.us")),
  );

  return {
    from: String(from),
    messageId: String(messageId),
    text: text ? String(text) : undefined,
    type,
    timestamp,
    fromMe,
    wasSentByApi,
    isGroup,
  };
}
