const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Message = require("../models/Message");

// ─── In-memory stores ────────────────────────────────────────────────────────
const onlineUsers = new Map();   // userId (string) → socketId
const pendingDeliveries = new Map(); // userId (string) → [{ event, payload }]

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Queue an event for a user who is currently offline.
 * Flushed automatically when they reconnect.
 */
function queueForOfflineUser(userId, event, payload) {
  if (!pendingDeliveries.has(userId)) {
    pendingDeliveries.set(userId, []);
  }
  pendingDeliveries.get(userId).push({ event, payload });
}

/**
 * Flush all queued events to a socket that just came online.
 */
function flushPendingDeliveries(userId, socket) {
  const queue = pendingDeliveries.get(userId);
  if (!queue || queue.length === 0) return;
  queue.forEach(({ event, payload }) => socket.emit(event, payload));
  pendingDeliveries.delete(userId);
}

/**
 * Send a real-time event to a user by their userId.
 * Falls back to offline queue if the user is not connected.
 *
 * @param {object} ioInstance  - The Socket.IO server instance
 * @param {string} userId      - Target user's MongoDB _id as string
 * @param {string} event       - Socket event name
 * @param {object} payload     - Event payload
 * @param {string} [senderId]  - Optional: sender userId to emit delivery ack back
 */
function emitToUser(ioInstance, userId, event, payload, senderId = null) {
  const socketId = onlineUsers.get(userId);

  if (socketId) {
    ioInstance.to(socketId).emit(event, payload);

    // Emit delivery acknowledgement back to sender
    if (senderId && event === "receiveMessage") {
      if (payload.message?._id) {
        Message.findByIdAndUpdate(payload.message._id, { status: "delivered" })
          .catch((err) => console.error("[Socket] Failed to persist delivered status:", err.message));
      }
      const senderSocketId = onlineUsers.get(senderId);
      if (senderSocketId) {
        ioInstance.to(senderSocketId).emit("messageDelivered", {
          messageId: payload.message?._id,
          deliveredTo: userId,
          deliveredAt: new Date().toISOString(),
        });
      }
    }
  } else {
    // User is offline — queue the event for when they reconnect
    queueForOfflineUser(userId, event, payload);
  }
}

// ─── Socket.IO JWT Middleware ─────────────────────────────────────────────────
/**
 * Authenticates every socket connection using the JWT passed in
 * socket.handshake.auth.token  (set on the client as { auth: { token } })
 * Rejects the connection if the token is missing, invalid, or the user
 * no longer exists — identical logic to authMiddleware.js.
 */
async function socketAuthMiddleware(socket, next) {
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.split(" ")[1];

    if (!token) {
      return next(new Error("Authentication error: token missing"));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select(
      "_id displayName email publicKey isOnline"
    );

    if (!user) {
      return next(new Error("Authentication error: user not found"));
    }

    // Attach the verified user to the socket — never trust client-supplied userId
    socket.user = user;
    next();
  } catch (err) {
    return next(new Error("Authentication error: invalid or expired token"));
  }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────
let io;

function initSocket(socketServer) {
  io = socketServer;

  // Apply JWT auth middleware to ALL connections before they are accepted
  io.use(socketAuthMiddleware);

  io.on("connection", async (socket) => {
    const userId = socket.user._id.toString();
    console.log(`[Socket] Connected: ${socket.id} | User: ${userId}`);

    // ── Register user as online ──────────────────────────────────────────────
    onlineUsers.set(userId, socket.id);

    // Join a private room named after the userId (used for targeted delivery)
    socket.join(userId);

    try {
      await User.findByIdAndUpdate(userId, { isOnline: true });
    } catch (e) {
      console.error("[Socket] Failed to set user online:", e.message);
    }

    // Tell everyone else this user is now online
    socket.broadcast.emit("userOnline", { userId });

    // Tell this user which of their contacts are currently online
    const onlineList = Array.from(onlineUsers.keys()).filter(
      (id) => id !== userId
    );
    socket.emit("onlineUsers", onlineList);

    // Flush any messages/events that arrived while this user was offline
    flushPendingDeliveries(userId, socket);

    // ── Typing indicators ────────────────────────────────────────────────────
    // Use socket.user._id — never trust client-supplied fromUserId
    socket.on("typing", ({ toUserId }) => {
      if (!toUserId) return;
      const targetSocketId = onlineUsers.get(toUserId.toString());
      if (targetSocketId) {
        io.to(targetSocketId).emit("typing", { fromUserId: userId });
      }
    });

    socket.on("stopTyping", ({ toUserId }) => {
      if (!toUserId) return;
      const targetSocketId = onlineUsers.get(toUserId.toString());
      if (targetSocketId) {
        io.to(targetSocketId).emit("stopTyping", { fromUserId: userId });
      }
    });

    // ── Message read receipts ────────────────────────────────────────────────
    // Client emits this after the user opens a conversation and reads messages
    socket.on("messageRead", async ({ messageId, toUserId }) => {
      if (!messageId || !toUserId) return;

      try {
        // Persist read status in DB
        await Message.findByIdAndUpdate(messageId, { status: "read" });

        // Notify the original sender (double blue tick)
        const senderSocketId = onlineUsers.get(toUserId.toString());
        if (senderSocketId) {
          io.to(senderSocketId).emit("messageRead", {
            messageId,
            readBy: userId,
            readAt: new Date().toISOString(),
          });
        }
      } catch (e) {
        console.error("[Socket] messageRead error:", e.message);
      }
    });

    // ── Bulk read receipt (opening a conversation) ───────────────────────────
    // WhatsApp marks all messages as read when you open a chat
    socket.on("conversationRead", async ({ conversationId, toUserId }) => {
      if (!conversationId || !toUserId) return;

      try {
        const updated = await Message.updateMany(
          {
            conversation: conversationId,
            receiver: userId,
            status: { $ne: "read" },
          },
          { status: "read" }
        );

        if (updated.modifiedCount > 0) {
          const senderSocketId = onlineUsers.get(toUserId.toString());
          if (senderSocketId) {
            io.to(senderSocketId).emit("conversationRead", {
              conversationId,
              readBy: userId,
              readAt: new Date().toISOString(),
            });
          }
        }
      } catch (e) {
        console.error("[Socket] conversationRead error:", e.message);
      }
    });

    // ── Disconnect ───────────────────────────────────────────────────────────
    socket.on("disconnect", async (reason) => {
      console.log(
        `[Socket] Disconnected: ${socket.id} | User: ${userId} | Reason: ${reason}`
      );

      // Only remove from map if this socket is still the active one
      // (protects against duplicate tab reconnections)
      if (onlineUsers.get(userId) === socket.id) {
        onlineUsers.delete(userId);

        try {
          await User.findByIdAndUpdate(userId, {
            isOnline: false,
            lastSeen: new Date(),
          });
        } catch (e) {
          console.error("[Socket] Failed to set user offline:", e.message);
        }

        socket.broadcast.emit("userOffline", {
          userId,
          lastSeen: new Date().toISOString(),
        });
      }
    });
  });
}

// ─── Exported API ─────────────────────────────────────────────────────────────

/**
 * Send an encrypted message payload to a specific user.
 * Called by messageController after persisting the message to DB.
 *
 * @param {string} receiverId  - Target user's MongoDB _id as string
 * @param {object} payload     - Full message object (ciphertext, keys, integrity data)
 * @param {string} senderId    - Sender's _id — used to emit delivery ack back
 */
function sendMessageToUser(receiverId, payload, senderId) {
  if (!io) {
    console.warn("[Socket] sendMessageToUser called before io was initialised");
    return;
  }
  emitToUser(io, receiverId, "receiveMessage", payload, senderId);
}

function sendEventToUser(userId, event, payload) {
  if (!io) {
    console.warn("[Socket] sendEventToUser called before io was initialised");
    return;
  }

  emitToUser(io, userId, event, payload);
}

/**
 * Returns the list of currently online user IDs.
 */
function getOnlineUsers() {
  return Array.from(onlineUsers.keys());
}

/**
 * Returns true if a specific user is currently connected.
 */
function isUserOnline(userId) {
  return onlineUsers.has(userId.toString());
}

module.exports = initSocket;
module.exports.sendMessageToUser = sendMessageToUser;
module.exports.sendEventToUser = sendEventToUser;
module.exports.getOnlineUsers = getOnlineUsers;
module.exports.isUserOnline = isUserOnline;
