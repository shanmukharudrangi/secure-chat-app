import { getApiBaseUrl } from "./runtimeConfig";

const BASE = `${getApiBaseUrl()}/auth`;

export async function sendOTP(identifier) {
  const res = await fetch(`${BASE}/send-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier }),
  });
  return res.json();
}

export async function verifyOTP(identifier, otp, publicKey, signingPublicKey) {
  const res = await fetch(`${BASE}/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, otp, publicKey, signingPublicKey }),
  });
  return res.json();
}

export async function registerPublicKey(publicKey, signingPublicKey, token) {
  const res = await fetch(`${BASE}/register-key`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ publicKey, signingPublicKey }),
  });
  return res.json();
}
