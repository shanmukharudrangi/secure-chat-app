import { api } from "./api.js";

export async function getUsers() {
  return api.get("/users");
}

export async function searchUsersByUsername(username) {
  const query = new URLSearchParams({ username });
  return api.get(`/users/search?${query.toString()}`);
}

export async function getPublicKey(userId) {
  return api.get(`/users/${userId}/publicKey`);
}

export async function getUserProfile(userId) {
  return api.get(`/users/${userId}`);
}

export async function updateProfile(data) {
  return api.patch("/users/profile", data);
}

export async function createProfile(data) {
  return api.post("/profile/create-profile", data);
}

export async function checkProfile() {
  return api.get("/users/check-profile");
}

export async function getMe() {
  return api.get("/users/me");
}
