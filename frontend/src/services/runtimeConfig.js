function normalizeOrigin(value) {
  return value ? value.replace(/\/$/, "") : "";
}

function browserBackendOrigin() {
  if (typeof window === "undefined") {
    return "http://localhost:5000";
  }

  const { protocol, hostname, port, origin } = window.location;

  // In local Vite dev, infer the backend from the same host on port 5000
  // so other devices on the LAN do not accidentally connect to their own localhost.
  if (port === "3000") {
    return `${protocol}//${hostname}:5000`;
  }

  return origin;
}

export function getApiBaseUrl() {
  const configured = normalizeOrigin(import.meta.env.VITE_API_URL);
  const origin = configured || browserBackendOrigin();
  return `${origin}/api`;
}

export function getSocketUrl() {
  return normalizeOrigin(import.meta.env.VITE_SOCKET_URL) || browserBackendOrigin();
}
