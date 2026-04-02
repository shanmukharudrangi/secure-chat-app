const LEGACY_PRIVATE_KEY = "sc_pk_pem";
const LEGACY_PUBLIC_KEY = "sc_pub_pem";

function normalizeIdentifier(identifier = "") {
  return String(identifier).trim().toLowerCase();
}

function privateKeySlot(identifier) {
  return `sc_pk_pem:${normalizeIdentifier(identifier)}`;
}

function signingPrivateKeySlot(identifier) {
  return `sc_sk_pem:${normalizeIdentifier(identifier)}`;
}

function signingPublicKeySlot(identifier) {
  return `sc_spub_pem:${normalizeIdentifier(identifier)}`;
}

function publicKeySlot(identifier) {
  return `sc_pub_pem:${normalizeIdentifier(identifier)}`;
}

export function getStoredKeyPair(identifier) {
  const normalized = normalizeIdentifier(identifier);
  if (!normalized) {
    return { privateKeyPem: null, signingKeyPem: null, publicKeyPem: null };
  }

  return {
    privateKeyPem: localStorage.getItem(privateKeySlot(normalized)),
    signingKeyPem: localStorage.getItem(signingPrivateKeySlot(normalized)),
    signingPublicKeyPem: localStorage.getItem(signingPublicKeySlot(normalized)),
    publicKeyPem: localStorage.getItem(publicKeySlot(normalized)),
  };
}

export function storeKeyPair(identifier, { privateKeyPem, signingKeyPem, signingPublicKeyPem, publicKeyPem } = {}) {
  const normalized = normalizeIdentifier(identifier);
  if (!normalized) return;

  if (privateKeyPem) {
    localStorage.setItem(privateKeySlot(normalized), privateKeyPem);
  }

  if (signingKeyPem) {
    localStorage.setItem(signingPrivateKeySlot(normalized), signingKeyPem);
  }

  if (signingPublicKeyPem) {
    localStorage.setItem(signingPublicKeySlot(normalized), signingPublicKeyPem);
  }

  if (publicKeyPem) {
    localStorage.setItem(publicKeySlot(normalized), publicKeyPem);
  }
}

export function getLegacyKeyPair() {
  return {
    privateKeyPem: localStorage.getItem(LEGACY_PRIVATE_KEY),
    publicKeyPem: localStorage.getItem(LEGACY_PUBLIC_KEY),
  };
}

export function clearLegacyKeyPair() {
  localStorage.removeItem(LEGACY_PRIVATE_KEY);
  localStorage.removeItem(LEGACY_PUBLIC_KEY);
}

export function migrateLegacyKeyPair(identifier, fallbackPublicKeyPem = null) {
  const legacy = getLegacyKeyPair();
  if (!legacy.privateKeyPem && !legacy.publicKeyPem) {
    return null;
  }

  storeKeyPair(identifier, {
    privateKeyPem: legacy.privateKeyPem,
    publicKeyPem: legacy.publicKeyPem || fallbackPublicKeyPem,
  });
  clearLegacyKeyPair();

  return {
    privateKeyPem: legacy.privateKeyPem,
    publicKeyPem: legacy.publicKeyPem || fallbackPublicKeyPem,
  };
}

export function clearSessionStorage() {
  localStorage.removeItem("sc_user");
  localStorage.removeItem("sc_token");
}
