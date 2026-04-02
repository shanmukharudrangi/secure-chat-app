const crypto = require("crypto");
const SecurityLog = require("../models/SecurityLog");

exports.generateFingerprint = (data) => {
  return crypto.createHash("sha256").update(data).digest("hex");
};

exports.verifyIntegrity = (ciphertext, fingerprint) => {
  const computed = crypto.createHash("sha256").update(ciphertext).digest("hex");
  return computed === fingerprint;
};

exports.logSecurityEvent = async (userId, eventType, description, metadata = {}) => {
  try {
    const severity = eventType === "TAMPER_DETECTED" ? "critical"
      : eventType === "MESSAGE_SENT" ? "low"
      : "medium";

    await SecurityLog.create({ userId, eventType, description, metadata, severity });
  } catch (error) {
    console.error("Security log failed:", error);
  }
};

exports.calculateIntegrityScore = (signatureValid, fingerprintValid, authTagValid) => {
  let score = 0;
  if (signatureValid) score += 40;
  if (fingerprintValid) score += 30;
  if (authTagValid) score += 30;

  let status = "secure";
  if (score < 100) status = "warning";
  if (score < 60) status = "tampered";

  return { score, status };
};
