export type Role = "user" | "assistant";

export interface ConversationMessage {
  role: Role;
  content: string;
  timestamp: number;
}
