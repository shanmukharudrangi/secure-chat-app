const mongoose = require("mongoose");

const MessageSchema = new mongoose.Schema(
  {
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    replyTo: {
      messageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
      sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      preview: { type: String, default: "" },
    },

    // ── Encrypted payload (all encryption happens in the browser) ────────────
    ciphertext: { type: String, required: true },

    // AES key encrypted with the RECEIVER's RSA public key
    encryptedKey: { type: String },

    // AES key encrypted with the SENDER's RSA public key
    // Allows the sender to decrypt their own sent messages
    senderEncryptedKey: { type: String },

    iv: { type: String },
    authTag: { type: String },

    // ── Integrity & verification ─────────────────────────────────────────────
    fingerprint: { type: String },   // SHA-256 hash of ciphertext
    signature: { type: String },     // RSA-PSS digital signature by sender

    // Computed once at send time, stored to avoid re-verification on every fetch
    integrityScore:   { type: Number,  default: 0 },
    integrityStatus:  { type: String,  enum: ["secure", "warning", "tampered"], default: "warning" },
    signatureValid:   { type: Boolean, default: false },
    fingerprintValid: { type: Boolean, default: false },
    authTagValid:     { type: Boolean, default: false },
    tampered:         { type: Boolean, default: false },

    // ── Delivery status (WhatsApp tick model) ────────────────────────────────
    // "sent"      → saved to DB, not yet delivered to receiver's device (1 tick)
    // "delivered" → receiver's socket received it               (2 ticks grey)
    // "read"      → receiver opened the conversation            (2 ticks blue)
    status: {
      type: String,
      enum: ["sent", "delivered", "read"],
      default: "sent",
    },
    deletedFor: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    }],
    starredBy: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    }],
    deletedForEveryone: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true, // createdAt + updatedAt managed by Mongoose
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
// Primary query pattern: fetch all messages in a conversation ordered by time
MessageSchema.index({ conversation: 1, createdAt: 1 });

// Used by messageController to mark unread messages as delivered/read
MessageSchema.index({ receiver: 1, status: 1 });
MessageSchema.index({ "replyTo.messageId": 1 });

module.exports = mongoose.model("Message", MessageSchema);
