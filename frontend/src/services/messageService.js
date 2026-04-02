import { api } from "./api.js";

export async function sendMessage(payload) {
  return api.post("/messages/send", payload);
}

export async function getMessages(userId) {
  return api.get(`/messages/chat/${userId}`);
}

export async function getConversations() {
  return api.get("/messages/conversations");
}

export async function deleteChat(userId) {
  return api.delete(`/messages/chat/${userId}`);
}

export async function clearChat(userId) {
  return api.delete(`/messages/chat/${userId}/clear`);
}

export async function togglePinChat(userId) {
  return api.patch(`/messages/chat/${userId}/pin`);
}

export async function toggleArchiveChat(userId) {
  return api.patch(`/messages/chat/${userId}/archive`);
}

export async function deleteMessage(messageId) {
  return api.delete(`/messages/${messageId}`);
}

export async function toggleStarMessage(messageId) {
  return api.patch(`/messages/${messageId}/star`);
}

export async function deleteMessageForEveryone(messageId) {
  return api.delete(`/messages/${messageId}/everyone`);
}
