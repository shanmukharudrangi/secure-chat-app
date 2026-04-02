import { api } from "./api.js";

/**
 * Send a plaintext message to the AI assistant.
 *
 * @param {string} message              - The user's question (plaintext only)
 * @param {Array}  conversationHistory  - Last N AI turns for context
 *   Each item: { role: "user"|"assistant", content: string }
 *
 * @returns {{ reply: string, remaining: number }}
 */
export async function askAI(message, conversationHistory = []) {
  return api.post("/ai/chat", {
    message,
    conversationHistory,
  });
}