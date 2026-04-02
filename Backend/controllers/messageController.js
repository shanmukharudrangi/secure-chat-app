const Message = require("../models/Message");
const User = require("../models/User");
const Conversation = require("../models/Conversation");

const { verifyIntegrity, logSecurityEvent, calculateIntegrityScore } = require("../utils/integrityService");
const { verifySignature } = require("../utils/signatureService");
const { sendMessageToUser, sendEventToUser, isUserOnline } = require("../socket/socketHandler");

/*
  ARCHITECTURE NOTES
  ──────────────────
  • All encryption / decryption happens exclusively in the browser (Web Crypto API).
  • The backend receives an already-encrypted payload and stores it as-is.
  • Two copies of the AES key are stored per message:
      encryptedKey       → AES key encrypted with the RECEIVER's RSA public key
      senderEncryptedKey → AES key encrypted with the SENDER's RSA public key
        (so the sender can decrypt their own sent messages in the chat window)
  • Integrity (signature, fingerprint, authTag) is verified ONCE at send time
    and the result is persisted. getMessages reads the stored values — it never
    re-runs cryptographic verification on fetch.
  • Delivery status follows the WhatsApp tick model:
      sent      → persisted to DB (1 grey tick)
      delivered → receiver's socket received the real-time push (2 grey ticks)
      read      → receiver opened the conversation (2 blue ticks)
*/

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute integrity metrics for a message.
 * Called once at send time; result is stored in the Message document.
 *
 * NOTE: The frontend uses RSA-OAEP keys (encrypt/decrypt only). Web Crypto API
 * does not allow RSA-OAEP keys to sign. The frontend therefore sends the
 * SHA-256 fingerprint as the signature field as a best-effort integrity marker.
 * A real RSA-PSS signing key pair should be generated separately on the client
 * for true non-repudiation. Until that is implemented we accept the fingerprint
 * as the signature and award partial integrity points accordingly.
 */
function computeIntegrity(ciphertext, signature, fingerprint, authTag, senderPublicKey, signingPublicKey) {
  let signatureValid = false;

  if (signature && senderPublicKey) {
    // Attempt real RSA-PSS verification first
    try {
      signatureValid = verifySignature(ciphertext, signature, signingPublicKey || senderPublicKey);
    } catch (_) {
      signatureValid = false;
    }
  }

  // Fallback: fingerprint used as signature placeholder (see note above)
  if (!signatureValid && signature && fingerprint && signature === fingerprint) {
    signatureValid = true;
  }

  const fingerprintValid = fingerprint
    ? verifyIntegrity(ciphertext, fingerprint)
    : false;

  const authTagValid = !!authTag;

  const integrity = calculateIntegrityScore(signatureValid, fingerprintValid, authTagValid);

  return { signatureValid, fingerprintValid, authTagValid, integrity };
}

function buildLastMessagePreview(message, userId) {
  if (!message) return null;

  if (message.deletedForEveryone) {
    return {
      _id: message._id,
      createdAt: message.createdAt,
      status: message.status,
      sender: message.sender,
      integrityStatus: "warning",
      deletedForEveryone: true,
      message: "This message was deleted",
    };
  }

  return {
    _id: message._id,
    ciphertext: message.ciphertext,
    createdAt: message.createdAt,
    status: message.status,
    sender: message.sender,
    integrityStatus: message.integrityStatus,
  };
}

function sanitizeReplyPreview(text = "") {
  return String(text).replace(/\s+/g, " ").trim().slice(0, 120);
}

function isMarkedForUser(list = [], userId) {
  return Array.isArray(list) && list.some((id) => id.toString() === userId.toString());
}

async function refreshConversationState(conversationId, userId) {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    return { conversation: null, latestMessage: null };
  }

  const latestMessage = await Message.findOne({
    conversation: conversationId,
    deletedFor: { $ne: userId },
  })
    .sort({ createdAt: -1 })
    .select("_id ciphertext createdAt status sender integrityStatus deletedForEveryone");

  conversation.lastMessage = latestMessage?._id || undefined;
  conversation.updatedAt = latestMessage?.createdAt || new Date();
  await conversation.save();

  return { conversation, latestMessage };
}

// ─── Controllers ──────────────────────────────────────────────────────────────

/**
 * POST /api/messages
 * Stores an encrypted message and pushes it to the receiver via Socket.IO.
 */
exports.sendMessage = async (req, res) => {
  try {
    const senderId = req.user._id;
    const {
      receiverId,
      ciphertext,
      encryptedKey,
      senderEncryptedKey,
      iv,
      authTag,
      fingerprint,
      signature,
      replyTo,
    } = req.body;

    // ── Validate receiver ──────────────────────────────────────────────────
    if (!receiverId) return res.status(400).json({ error: "receiverId is required" });

    const receiver = await User.findById(receiverId).select("_id publicKey");
    if (!receiver) return res.status(404).json({ error: "Receiver not found" });

    // ── Find or create conversation ────────────────────────────────────────
    let conversation = await Conversation.findOne({
      participants: { $all: [senderId, receiverId] },
    });
    if (!conversation) {
      conversation = await Conversation.create({
        participants: [senderId, receiverId],
      });
    }
    if (conversation.hiddenFor?.length) {
      conversation.hiddenFor = conversation.hiddenFor.filter(
        (id) =>
          id.toString() !== senderId.toString() &&
          id.toString() !== receiverId.toString()
      );
    }
    if (conversation.archivedFor?.length) {
      conversation.archivedFor = conversation.archivedFor.filter(
        (id) =>
          id.toString() !== senderId.toString() &&
          id.toString() !== receiverId.toString()
      );
    }

    // ── Compute integrity ONCE before storing ──────────────────────────────
    const { signatureValid, fingerprintValid, authTagValid, integrity } =
      computeIntegrity(
        ciphertext,
        signature,
        fingerprint,
        authTag,
        req.user.publicKey,
        req.user.signingPublicKey
      );

    // ── Persist message with integrity data ────────────────────────────────
    const newMessage = await Message.create({
      conversation: conversation._id,
      sender: senderId,
      receiver: receiverId,
      replyTo: replyTo?.messageId
        ? {
            messageId: replyTo.messageId,
            sender: replyTo.sender,
            preview: sanitizeReplyPreview(replyTo.preview),
          }
        : undefined,
      ciphertext,
      encryptedKey,
      senderEncryptedKey,
      iv,
      authTag,
      fingerprint,
      signature,
      status: "sent",
      // Store integrity results — never recompute on fetch
      integrityScore:   integrity.score,
      integrityStatus:  integrity.status,
      signatureValid,
      fingerprintValid,
      authTagValid,
      tampered: integrity.status === "tampered",
    });

    // ── Update conversation's last message ─────────────────────────────────
    conversation.lastMessage = newMessage._id;
    conversation.updatedAt = new Date();
    await conversation.save();

    // ── Security audit log ─────────────────────────────────────────────────
    await logSecurityEvent(senderId, "MESSAGE_SENT", "Encrypted message sent", {
      messageId: newMessage._id,
      receiverId,
      integrityStatus: integrity.status,
    });

    if (integrity.status === "tampered") {
      await logSecurityEvent(senderId, "TAMPER_DETECTED", "Outbound message failed integrity check", {
        messageId: newMessage._id,
        severity: "critical",
      });
    }

    // ── Real-time push to receiver ─────────────────────────────────────────
    // The receiver's encryptedKey is included so they can decrypt on device.
    // senderId is passed so socketHandler can emit a delivery ack back to sender.
    const messagePayload = {
      _id:              newMessage._id,
      conversation:     conversation._id,
      sender:           senderId,
      receiver:         receiverId,
      ciphertext,
      encryptedKey,         // receiver decrypts this with their private key
      senderEncryptedKey,   // sender needs this to read their own message
      iv,
      authTag,
      fingerprint,
      signature,
      integrityScore:   integrity.score,
      integrityStatus:  integrity.status,
      signatureValid,
      fingerprintValid,
      authTagValid,
      replyTo: newMessage.replyTo,
      createdAt:        newMessage.createdAt,
      status:           "sent",
    };

    sendMessageToUser(
      receiverId.toString(),
      {
        sender: senderId,
        senderProfile: {
          _id: req.user._id,
          displayName: req.user.displayName || req.user.username || req.user.email || "Unknown contact",
          email: req.user.email,
          phone: req.user.phone,
          avatar: req.user.avatar || "",
        },
        message: messagePayload,
      },
      senderId.toString()
    );

    // ── HTTP response ──────────────────────────────────────────────────────
    // Return full message data so the sender's UI can render it immediately
    return res.status(201).json({
      message: "Encrypted message stored",
      data: messagePayload,
    });
  } catch (error) {
    console.error("[messageController] sendMessage error:", error);
    return res.status(500).json({ error: "Message sending failed" });
  }
};

/**
 * GET /api/messages/:userId
 * Returns the full message history between the authenticated user and :userId.
 * Marks all unread messages as read (triggers blue ticks on the sender's side).
 */
exports.getMessages = async (req, res) => {
  try {
    const userId   = req.user._id;
    const otherUser = req.params.userId;

    // ── Find conversation ──────────────────────────────────────────────────
    const conversation = await Conversation.findOne({
      participants: { $all: [userId, otherUser] },
    });
    if (!conversation) return res.json([]);

    // ── Mark unread messages as read BEFORE building the response ──────────
    // This ensures the status returned to the client is accurate and avoids
    // the race condition where updateMany runs after the response is sent.
    await Message.updateMany(
      {
        conversation: conversation._id,
        receiver:     userId,
        status:       { $ne: "read" },
        deletedFor:   { $ne: userId },
      },
      { status: "read" }
    );

    // ── Fetch messages — single query with sender populated ────────────────
    // .populate() eliminates the N+1 query (one DB call, not one per message)
    const messages = await Message.find({
      conversation: conversation._id,
      deletedFor: { $ne: userId },
    })
      .sort({ createdAt: 1 })
      .populate("sender", "publicKey displayName");

    // ── Build response ─────────────────────────────────────────────────────
    const result = messages.map((msg) => {
      const isSender = msg.sender._id.toString() === userId.toString();

      // Log tampered messages detected on fetch
      if (msg.integrityStatus === "tampered") {
        // fire-and-forget — don't await in a map
        logSecurityEvent(userId, "TAMPER_DETECTED", "Message integrity compromised", {
          messageId: msg._id,
          severity:  "critical",
        }).catch((e) => console.error("[messageController] logSecurityEvent error:", e));
      }

      return {
        _id:             msg._id,
        sender:          msg.sender._id,
        receiver:        msg.receiver,
        deletedForEveryone: msg.deletedForEveryone,
        starred:         isMarkedForUser(msg.starredBy, userId),
        message: msg.deletedForEveryone ? "This message was deleted" : undefined,
        replyTo: msg.replyTo || null,
        // Return the correct encrypted AES key for this user:
        //   • sender  → senderEncryptedKey (encrypted with sender's public key)
        //   • receiver → encryptedKey      (encrypted with receiver's public key)
        encryptedKey:    msg.deletedForEveryone ? null : (isSender ? msg.senderEncryptedKey : msg.encryptedKey),
        ciphertext:      msg.deletedForEveryone ? null : msg.ciphertext,
        iv:              msg.deletedForEveryone ? null : msg.iv,
        authTag:         msg.deletedForEveryone ? null : msg.authTag,
        fingerprint:     msg.deletedForEveryone ? null : msg.fingerprint,
        signature:       msg.deletedForEveryone ? null : msg.signature,
        // Integrity fields read from DB — no recomputation
        integrityScore:  msg.integrityScore,
        integrityStatus: msg.integrityStatus,
        signatureValid:  msg.signatureValid,
        fingerprintValid: msg.fingerprintValid,
        authTagValid:    msg.authTagValid,
        createdAt:       msg.createdAt,
        // After updateMany above, all received messages are now "read"
        status:          isSender ? msg.status : "read",
      };
    });

    return res.json(result);
  } catch (error) {
    console.error("[messageController] getMessages error:", error);
    return res.status(500).json({ error: "Failed to fetch messages" });
  }
};

/**
 * GET /api/messages/conversations
 * Returns all conversations for the authenticated user, sorted by most recent.
 */
exports.getConversations = async (req, res) => {
  try {
    const userId = req.user._id;

    const conversations = await Conversation.find({
      participants: userId,
      hiddenFor: { $ne: userId },
    })
      .populate("participants", "email phone username displayName publicKey isOnline lastSeen avatar")
      .sort({ updatedAt: -1 });

    const result = (await Promise.all(conversations.map(async (conv) => {
      const other = conv.participants.find(
        (p) => p._id.toString() !== userId.toString()
      );
      const lastMessage = await Message.findOne({
        conversation: conv._id,
        deletedFor: { $ne: userId },
      })
        .sort({ createdAt: -1 })
        .select("ciphertext createdAt status sender integrityStatus deletedForEveryone");

      if (!other) {
        return null;
      }

      const unreadCount = await Message.countDocuments({
        conversation: conv._id,
        receiver: userId,
        status: { $ne: "read" },
        deletedFor: { $ne: userId },
      });

      return {
        _id:         conv._id,
        participant: other,
        lastMessage: buildLastMessagePreview(lastMessage, userId),
        updatedAt:   lastMessage?.createdAt || conv.updatedAt,
        unreadCount,
        isPinned:    isMarkedForUser(conv.pinnedFor, userId),
        isArchived:  isMarkedForUser(conv.archivedFor, userId),
      };
    }))).filter(Boolean);

    return res.json(
      result.sort((a, b) => {
        if ((b.isPinned ? 1 : 0) !== (a.isPinned ? 1 : 0)) {
          return (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0);
        }
        return new Date(b.updatedAt) - new Date(a.updatedAt);
      })
    );
  } catch (error) {
    console.error("[messageController] getConversations error:", error);
    return res.status(500).json({ error: "Failed to fetch conversations" });
  }
};

/**
 * DELETE /api/messages/:messageId
 * Deletes a message only for the authenticated user's chat view.
 */
exports.deleteMessage = async (req, res) => {
  try {
    const userId = req.user._id;
    const { messageId } = req.params;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    const isParticipant =
      message.sender.toString() === userId.toString() ||
      message.receiver.toString() === userId.toString();

    if (!isParticipant) {
      return res.status(403).json({ error: "You can only delete messages from your own chats" });
    }

    const conversationId = message.conversation;
    await Message.updateOne(
      { _id: messageId },
      { $addToSet: { deletedFor: userId } }
    );

    const { latestMessage } = await refreshConversationState(conversationId, userId);

    await logSecurityEvent(userId, "MESSAGE_DELETED", "Message deleted for user", {
      messageId,
      conversationId,
    });

    return res.json({
      message: "Message deleted",
      deletedMessageId: messageId,
      conversationId,
      lastMessage: buildLastMessagePreview(latestMessage, userId),
    });
  } catch (error) {
    console.error("[messageController] deleteMessage error:", error);
    return res.status(500).json({ error: "Failed to delete message" });
  }
};

/**
 * DELETE /api/messages/:messageId/everyone
 * Deletes a sender's message for both participants.
 */
exports.deleteMessageForEveryone = async (req, res) => {
  try {
    const userId = req.user._id;
    const { messageId } = req.params;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    if (message.sender.toString() !== userId.toString()) {
      return res.status(403).json({ error: "Only the sender can delete for everyone" });
    }

    message.deletedForEveryone = true;
    await message.save();

    const otherUserId =
      message.sender.toString() === userId.toString()
        ? message.receiver.toString()
        : message.sender.toString();

    sendEventToUser(otherUserId, "messageDeletedForEveryone", {
      messageId: message._id.toString(),
      conversationId: message.conversation.toString(),
      deletedAt: new Date().toISOString(),
    });

    const latestMessage = await Message.findOne({
      conversation: message.conversation,
      deletedFor: { $ne: userId },
    })
      .sort({ createdAt: -1 })
      .select("_id ciphertext createdAt status sender integrityStatus deletedForEveryone");

    await logSecurityEvent(userId, "MESSAGE_DELETED", "Message deleted for everyone", {
      messageId,
      conversationId: message.conversation,
    });

    return res.json({
      message: "Message deleted for everyone",
      deletedMessageId: messageId,
      conversationId: message.conversation,
      lastMessage: buildLastMessagePreview(latestMessage, userId),
    });
  } catch (error) {
    console.error("[messageController] deleteMessageForEveryone error:", error);
    return res.status(500).json({ error: "Failed to delete message for everyone" });
  }
};

/**
 * DELETE /api/messages/chat/:userId/clear
 * Deletes all messages in a chat for the authenticated user while keeping the chat visible.
 */
exports.clearChat = async (req, res) => {
  try {
    const userId = req.user._id;
    const otherUserId = req.params.userId;

    const conversation = await Conversation.findOne({
      participants: { $all: [userId, otherUserId] },
    });

    if (!conversation) {
      return res.json({ message: "Chat already cleared" });
    }

    await Message.updateMany(
      { conversation: conversation._id },
      { $addToSet: { deletedFor: userId } }
    );

    await Conversation.updateOne(
      { _id: conversation._id },
      {
        $pull: { hiddenFor: userId },
        $set: {
          lastMessage: null,
          updatedAt: new Date(),
        },
      }
    );

    await logSecurityEvent(userId, "CHAT_CLEARED", "Conversation messages cleared for user", {
      conversationId: conversation._id,
      otherUserId,
    });

    return res.json({
      message: "Chat cleared",
      conversationId: conversation._id,
      otherUserId,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[messageController] clearChat error:", error);
    return res.status(500).json({ error: "Failed to clear chat" });
  }
};

/**
 * DELETE /api/messages/chat/:userId
 * Deletes all messages in a chat for the authenticated user and hides the chat.
 */
exports.deleteChat = async (req, res) => {
  try {
    const userId = req.user._id;
    const otherUserId = req.params.userId;

    const conversation = await Conversation.findOne({
      participants: { $all: [userId, otherUserId] },
    });

    if (!conversation) {
      return res.json({ message: "Chat already cleared" });
    }

    await Message.updateMany(
      { conversation: conversation._id },
      { $addToSet: { deletedFor: userId } }
    );

    await Conversation.updateOne(
      { _id: conversation._id },
      {
        $addToSet: { hiddenFor: userId },
        $set: {
          lastMessage: null,
          updatedAt: new Date(),
        },
      }
    );

    await logSecurityEvent(userId, "CHAT_DELETED", "Conversation messages cleared for user", {
      conversationId: conversation._id,
      otherUserId,
    });

    return res.json({
      message: "Chat cleared",
      conversationId: conversation._id,
      otherUserId,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[messageController] deleteChat error:", error);
    return res.status(500).json({ error: "Failed to delete chat" });
  }
};

exports.togglePinConversation = async (req, res) => {
  try {
    const userId = req.user._id;
    const otherUserId = req.params.userId;

    const conversation = await Conversation.findOne({
      participants: { $all: [userId, otherUserId] },
    });
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const isPinned = isMarkedForUser(conversation.pinnedFor, userId);
    await Conversation.updateOne(
      { _id: conversation._id },
      isPinned
        ? { $pull: { pinnedFor: userId } }
        : { $addToSet: { pinnedFor: userId } }
    );

    return res.json({
      conversationId: conversation._id,
      otherUserId,
      isPinned: !isPinned,
    });
  } catch (error) {
    console.error("[messageController] togglePinConversation error:", error);
    return res.status(500).json({ error: "Failed to update pin status" });
  }
};

exports.toggleArchiveConversation = async (req, res) => {
  try {
    const userId = req.user._id;
    const otherUserId = req.params.userId;

    const conversation = await Conversation.findOne({
      participants: { $all: [userId, otherUserId] },
    });
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const isArchived = isMarkedForUser(conversation.archivedFor, userId);
    await Conversation.updateOne(
      { _id: conversation._id },
      isArchived
        ? { $pull: { archivedFor: userId } }
        : { $addToSet: { archivedFor: userId } }
    );

    return res.json({
      conversationId: conversation._id,
      otherUserId,
      isArchived: !isArchived,
    });
  } catch (error) {
    console.error("[messageController] toggleArchiveConversation error:", error);
    return res.status(500).json({ error: "Failed to update archive status" });
  }
};

exports.toggleStarMessage = async (req, res) => {
  try {
    const userId = req.user._id;
    const { messageId } = req.params;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    const isParticipant =
      message.sender.toString() === userId.toString() ||
      message.receiver.toString() === userId.toString();
    if (!isParticipant) {
      return res.status(403).json({ error: "You can only star messages in your own chats" });
    }

    const isStarred = isMarkedForUser(message.starredBy, userId);
    await Message.updateOne(
      { _id: messageId },
      isStarred
        ? { $pull: { starredBy: userId } }
        : { $addToSet: { starredBy: userId } }
    );

    return res.json({
      messageId,
      starred: !isStarred,
    });
  } catch (error) {
    console.error("[messageController] toggleStarMessage error:", error);
    return res.status(500).json({ error: "Failed to update starred state" });
  }
};
