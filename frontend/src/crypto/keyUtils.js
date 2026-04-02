// Generate RSA-OAEP key pair for encryption/decryption
export async function generateRSAKeyPair() {
  return window.crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true, // extractable
    ["encrypt", "decrypt"]
  );
}

// Generate RSA-PSS key pair for digital signatures
export async function generateSigningKeyPair() {
  return window.crypto.subtle.generateKey(
    {
      name: "RSA-PSS",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true, // extractable
    ["sign", "verify"]
  );
}

// Export public key as PEM string (for sending to backend / other users)
export async function exportPublicKeyPem(publicKey) {
  const exported = await window.crypto.subtle.exportKey("spki", publicKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(exported)));
  return `-----BEGIN PUBLIC KEY-----\n${b64.match(/.{1,64}/g).join("\n")}\n-----END PUBLIC KEY-----`;
}

// Export private key as PEM string (for localStorage storage)
export async function exportPrivateKeyPem(privateKey) {
  const exported = await window.crypto.subtle.exportKey("pkcs8", privateKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(exported)));
  return `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----`;
}

// Import public key PEM → CryptoKey (for encrypting AES key to send to someone)
export async function importPublicKeyPem(pem) {
  const b64 = pem
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return window.crypto.subtle.importKey(
    "spki",
    der.buffer,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
}

// Import signing public key PEM → CryptoKey (for verifying signatures)
export async function importSigningPublicKeyPem(pem) {
  const b64 = pem
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return window.crypto.subtle.importKey(
    "spki",
    der.buffer,
    { name: "RSA-PSS", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

// Import private key PEM → CryptoKey (for decrypting AES key)
export async function importPrivateKeyPem(pem) {
  const b64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return window.crypto.subtle.importKey(
    "pkcs8",
    der.buffer,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"]
  );
}

// Import signing private key PEM → CryptoKey (for signing messages)
export async function importSigningPrivateKeyPem(pem) {
  const b64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return window.crypto.subtle.importKey(
    "pkcs8",
    der.buffer,
    { name: "RSA-PSS", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

// Encrypt raw bytes (AES key) with RSA public key → base64 string
export async function encryptWithPublicKey(aesKeyBytes, publicKeyCrypto) {
  const encrypted = await window.crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKeyCrypto,
    aesKeyBytes
  );
  return bufToHex(encrypted);
}

// Decrypt hex-encoded ciphertext with RSA private key → ArrayBuffer
export async function decryptWithPrivateKey(hexCiphertext, privateKeyCrypto) {
  const buf = hexToBuf(hexCiphertext);
  return window.crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKeyCrypto,
    buf
  );
}

// Sign data with RSA-PSS private key → hex signature
export async function signData(privateKeyCrypto, data) {
  const encoder = new TextEncoder();
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  const signature = await window.crypto.subtle.sign(
    { name: "RSA-PSS", saltLength: 32 },
    privateKeyCrypto,
    bytes
  );
  return bufToHex(signature);
}

// Verify RSA-PSS signature → boolean
export async function verifySignature(publicKeyCrypto, data, hexSignature) {
  const encoder = new TextEncoder();
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  const signature = hexToBuf(hexSignature);
  return window.crypto.subtle.verify(
    { name: "RSA-PSS", saltLength: 32 },
    publicKeyCrypto,
    signature,
    bytes
  );
}

// AES-256-GCM encryption → returns hex strings
export async function aesEncrypt(plaintext) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  const aesKey = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );

  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    data
  );

  // Export raw AES key bytes
  const rawKey = await window.crypto.subtle.exportKey("raw", aesKey);

  const encBytes = new Uint8Array(encrypted);
  // AES-GCM appends 16-byte auth tag at the end
  const authTag = encBytes.slice(-16);
  const ciphertext = encBytes.slice(0, -16);

  return {
    ciphertext: bufToHex(ciphertext),
    iv: bufToHex(iv),
    authTag: bufToHex(authTag),
    rawKey: new Uint8Array(rawKey)
  };
}

// AES-256-GCM decryption from hex strings
export async function aesDecrypt(ciphertextHex, ivHex, authTagHex, aesKeyBytes) {
  const aesKey = await window.crypto.subtle.importKey(
    "raw",
    aesKeyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const ciphertext = hexToBuf(ciphertextHex);
  const iv = hexToBuf(ivHex);
  const authTag = hexToBuf(authTagHex);

  // Combine ciphertext + authTag (required by Web Crypto AES-GCM)
  const combined = new Uint8Array(ciphertext.byteLength + authTag.byteLength);
  combined.set(new Uint8Array(ciphertext));
  combined.set(new Uint8Array(authTag), ciphertext.byteLength);

  const decrypted = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) },
    aesKey,
    combined
  );

  return new TextDecoder().decode(decrypted);
}

// SHA-256 fingerprint of a string → hex
export async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const hash = await window.crypto.subtle.digest("SHA-256", data);
  return bufToHex(hash);
}

// Helpers
export function bufToHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes.buffer;
}
