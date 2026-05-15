import { Redis } from "@upstash/redis";
import type { ConversationMessage } from "./types.js";

const redis = Redis.fromEnv();

const HISTORY_MAX_TURNS = Number(process.env.HISTORY_MAX_TURNS ?? 20);
const MESSAGE_DEDUP_TTL_SECONDS = 60 * 60 * 24;

const historyKey = (waId: string) => `wa:history:${waId}`;
const dedupKey = (messageId: string) => `wa:msg:${messageId}`;

export async function getHistory(waId: string): Promise<ConversationMessage[]> {
  const items = await redis.lrange<ConversationMessage>(historyKey(waId), 0, -1);
  return items ?? [];
}

export async function appendHistory(
  waId: string,
  message: ConversationMessage,
): Promise<void> {
  const key = historyKey(waId);
  await redis.rpush(key, message);
  await redis.ltrim(key, -HISTORY_MAX_TURNS * 2, -1);
}

export async function clearHistory(waId: string): Promise<void> {
  await redis.del(historyKey(waId));
}

export async function markMessageProcessed(messageId: string): Promise<boolean> {
  const result = await redis.set(dedupKey(messageId), "1", {
    ex: MESSAGE_DEDUP_TTL_SECONDS,
    nx: true,
  });
  return result === "OK";
}
