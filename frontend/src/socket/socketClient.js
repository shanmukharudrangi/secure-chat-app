import { io } from "socket.io-client";
import { getSocketUrl } from "../services/runtimeConfig";

const SOCKET_URL = getSocketUrl();

let socket = null;

/**
 * Creates and connects the socket with the current JWT token.
 * Called by AuthContext after a successful login.
 * Safe to call multiple times — returns existing socket if already connected.
 */
export function connectSocket() {
  // If a healthy socket already exists, reuse it
  if (socket && socket.connected) return socket;

  // If a disconnected socket exists, clean it up before creating a new one
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  const token = localStorage.getItem("sc_token");
  if (!token) {
    console.warn("[Socket] connectSocket called without a token — aborting");
    return null;
  }

  socket = io(SOCKET_URL, {
    // Pass JWT in the handshake — required by socketAuthMiddleware on the server
    auth: { token },

    // Do NOT auto-connect on import — connect only when this function is called
    autoConnect: true,

    // Reconnection settings (WhatsApp-style resilience)
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,       // start at 1s
    reconnectionDelayMax: 30000,   // cap at 30s
    randomizationFactor: 0.5,      // jitter to avoid thundering herd
    withCredentials: true,
    timeout: 20000,
    // Allow polling fallback for devices/networks where WebSocket upgrade
    // is blocked or unreliable; Socket.IO will upgrade when possible.
    transports: ["polling", "websocket"],
  });

  // ── Lifecycle events ──────────────────────────────────────────────────────

  socket.on("connect", () => {
    console.log("[Socket] Connected:", socket.id);
  });

  // Before each reconnection attempt, refresh the token from storage.
  // This handles the case where the token was silently refreshed while
  // the socket was disconnected.
  socket.io.on("reconnect_attempt", () => {
    const freshToken = localStorage.getItem("sc_token");
    if (freshToken) {
      socket.auth = { token: freshToken };
    }
  });

  socket.io.on("reconnect", (attemptNumber) => {
    console.log(`[Socket] Reconnected after ${attemptNumber} attempt(s)`);
  });

  socket.io.on("reconnect_error", (err) => {
    console.warn("[Socket] Reconnection error:", err.message);
  });

  socket.on("connect_error", (err) => {
    // Authentication failures should not keep retrying — disconnect cleanly.
    // Other errors (network drop etc.) are handled by the reconnect logic above.
    if (err.message.startsWith("Authentication error")) {
      console.error("[Socket] Auth failed — stopping reconnection:", err.message);
      socket.disconnect();
    } else {
      console.warn("[Socket] Connection error:", err.message);
    }
  });

  socket.on("disconnect", (reason) => {
    console.log("[Socket] Disconnected:", reason);
    // "io server disconnect" means the server intentionally kicked the client
    // (e.g. invalid token). Don't auto-reconnect in that case.
    if (reason === "io server disconnect") {
      socket.disconnect();
    }
  });

  return socket;
}

/**
 * Disconnects and destroys the socket.
 * Called by AuthContext on logout.
 */
export function disconnectSocket() {
  if (socket) {
    console.log("[Socket] Disconnecting on logout");
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

/**
 * Returns the current socket instance.
 * Returns null if connectSocket() has not been called yet.
 * Use this in components — never import socket directly.
 */
export function getSocket() {
  return socket;
}
