import { clearSessionStorage } from "./keyStorage";
import { getApiBaseUrl } from "./runtimeConfig";

const BASE = getApiBaseUrl();

function getToken() {
  return localStorage.getItem("sc_token");
}

function headers(extra = {}) {
  const token = getToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

/**
 * Central response handler.
 * Throws a structured error for non-2xx responses so callers
 * can catch and handle failures rather than silently getting
 * an error object back as if it were data.
 */
async function handleResponse(res) {

  if (res.status === 401) {
    clearSessionStorage();

    if (window.location.pathname !== "/") {
      window.location.href = "/";
    }

    throw new Error("Unauthorized");
  }
  if (res.ok) return res.json();

  // Try to parse the server's error message
  let message = `Request failed: ${res.status} ${res.statusText}`;
  try {
    const body = await res.json();
    if (body?.error) message = body.error;
  } catch (_) {
    // body was not JSON — use the status text
  }

  const err = new Error(message);
  err.status = res.status;
  throw err;
}

export const api = {
  async post(path, body) {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    return handleResponse(res);
  },

  async get(path) {
    const res = await fetch(`${BASE}${path}`, {
      headers: headers(),
    });
    return handleResponse(res);
  },

  async patch(path, body) {
    const res = await fetch(`${BASE}${path}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify(body),
    });
    return handleResponse(res);
  },

  async delete(path) {
    const res = await fetch(`${BASE}${path}`, {
      method: "DELETE",
      headers: headers(),
    });
    return handleResponse(res);
  },
};

 
