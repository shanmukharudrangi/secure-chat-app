import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { getSocket } from "../socket/socketClient";
import { getConversations } from "../services/messageService";

const ChatContext = createContext();

/*
  ARCHITECTURE NOTES
  ──────────────────
  • Socket is accessed via getSocket() — never imported as a singleton.
    The socket is created by AuthContext after login; ChatContext reads it
    once it is available via a polling ref.
  • Message state is keyed by the OTHER user's ID (the chat partner).
    { [otherUserId]: Message[] }
  • Delivery status (sent → delivered → read) is tracked per message and
    updated in place when the server emits the corresponding ack events.
  • When a real-time message arrives the conversations list is reordered
    so the active conversation always appears at the top (WhatsApp behaviour).
  • conversationRead is emitted to the server when the user opens a chat,
    triggering blue ticks on the sender's side.
*/

export function ChatProvider({ children }) {
  // { [otherUserId]: Message[] }
  const [messages, setMessages]         = useState({});
  const [activeChat, setActiveChatRaw]  = useState(null);
  const [conversations, setConversations] = useState([]);
  const [typingUsers, setTypingUsers]   = useState({});
  // { [userId]: true }  — tracks who is online
  const [onlineUsers, setOnlineUsers]   = useState(new Set());
  // { [userId]: isoString } — last seen timestamps
  const [lastSeen, setLastSeen]         = useState({});
  const [securityPanel, setSecurityPanel] = useState(false);

  // Keep a ref to activeChat so socket handlers always see the current value
  // without needing to be re-registered on every state change
  const activeChatRef = useRef(null);
  const attachedSocketRef = useRef(null);

  // ── Socket listener registration ───────────────────────────────────────────
  useEffect(() => {
    function detachListeners(socket = attachedSocketRef.current) {
      if (!socket) return;

      socket.off("receiveMessage");
      socket.off("messageDelivered");
      socket.off("messageRead");
      socket.off("conversationRead");
      socket.off("messageDeletedForEveryone");
      socket.off("userOnline");
      socket.off("userOffline");
      socket.off("onlineUsers");
      socket.off("typing");
      socket.off("stopTyping");

      if (attachedSocketRef.current === socket) {
        attachedSocketRef.current = null;
      }
    }

    function registerListeners(socket) {
      if (!socket || attachedSocketRef.current === socket) return;

      detachListeners();
      attachedSocketRef.current = socket;

      // ── Incoming encrypted message ───────────────────────────────────────
      // The payload is the full encrypted message object from the server.
      // Decryption happens in ChatWindow when the message is rendered.
      socket.on("receiveMessage", ({ sender, senderProfile, message }) => {
        const chatId = sender.toString();
        const isActiveChat =
          activeChatRef.current?._id?.toString() === chatId;

        if (isActiveChat && message.conversation) {
          socket.emit("conversationRead", {
            conversationId: message.conversation,
            toUserId: chatId,
          });
        }

        setMessages((prev) => ({
          ...prev,
          [chatId]: [
            ...(prev[chatId] || []),
            {
              ...message,
              status: isActiveChat ? "read" : message.status,
              _needsDecrypt: true,
            },
          ],
        }));

        // Bubble this conversation to the top of the sidebar list
        setConversations((prev) => {
          const idx = prev.findIndex(
            (c) => c.participant?._id?.toString() === chatId
          );
          if (idx === -1) {
            return [
              {
                _id: message.conversation || `rt_${chatId}`,
                participant: senderProfile || {
                  _id: chatId,
                  displayName: "Unknown contact",
                },
                lastMessage: message,
                updatedAt: message.createdAt || new Date().toISOString(),
                unreadCount: isActiveChat ? 0 : 1,
                isPinned: false,
                isArchived: false,
              },
              ...prev,
            ];
          }
          const updated = [...prev];
          const [conv] = updated.splice(idx, 1);
          return [
            {
              ...conv,
              lastMessage: message,
              updatedAt: message.createdAt || new Date().toISOString(),
              unreadCount: isActiveChat ? 0 : (conv.unreadCount || 0) + 1,
              isArchived: false,
            },
            ...updated,
          ];
        });
      });

      // ── Delivery ack: our sent message reached the receiver's device ─────
      // Updates the message status from "sent" (1 tick) to "delivered" (2 ticks).
      // Also replaces the optimistic localId with the real server _id so future
      // status events (messageRead) can match the message correctly.
      socket.on("messageDelivered", ({ messageId, deliveredTo }) => {
        const chatId = deliveredTo.toString();
        const serverMsgId = messageId?.toString();
        setMessages((prev) => {
          if (!prev[chatId]) return prev;
          let matched = false;
          const updated = prev[chatId].map((m) => {
            if (m._id?.toString() === serverMsgId) {
              matched = true;
              return { ...m, status: "delivered" };
            }
            return m;
          });
          if (!matched) return prev;
          return { ...prev, [chatId]: updated };
        });
      });

      // ── Read receipt: receiver opened the conversation ───────────────────
      // Updates message status from "delivered" to "read" (2 blue ticks)
      socket.on("messageRead", ({ messageId, readBy }) => {
        const chatId = readBy.toString();
        setMessages((prev) => {
          if (!prev[chatId]) return prev;
          return {
            ...prev,
            [chatId]: prev[chatId].map((m) =>
              m._id?.toString() === messageId?.toString()
                ? { ...m, status: "read" }
                : m
            ),
          };
        });
      });

      // ── Bulk read receipt (opening a conversation) ───────────────────
      // When the receiver opens the chat, ALL messages from that chat partner
      // should turn blue. Update every message in prev[chatId] to status:"read".
      socket.on("conversationRead", ({ conversationId, readBy }) => {
        const chatId = readBy.toString();
        setMessages((prev) => {
          if (!prev[chatId]) return prev;
          const updated = prev[chatId].map((m) =>
            m.status !== "read" ? { ...m, status: "read" } : m
          );
          // Only trigger a re-render if something actually changed
          const changed = updated.some((m, i) => m !== prev[chatId][i]);
          if (!changed) return prev;
          return { ...prev, [chatId]: updated };
        });
      });

      socket.on("messageDeletedForEveryone", ({ messageId, conversationId }) => {
        const deletedMessageId = messageId?.toString();
        if (!deletedMessageId) return;

        setMessages((prev) => {
          let changed = false;
          const next = Object.fromEntries(
            Object.entries(prev).map(([chatKey, chatMessages]) => {
              const updatedMessages = chatMessages.map((msg) => {
                if (msg._id?.toString() !== deletedMessageId) {
                  return msg;
                }

                changed = true;
                return {
                  ...msg,
                  message: "This message was deleted",
                  deletedForEveryone: true,
                  ciphertext: null,
                  encryptedKey: null,
                  senderEncryptedKey: null,
                  iv: null,
                  authTag: null,
                  fingerprint: null,
                  signature: null,
                  integrityStatus: "warning",
                  _decrypted: true,
                  _needsDecrypt: false,
                };
              });

              return [chatKey, updatedMessages];
            })
          );

          return changed ? next : prev;
        });

        setConversations((prev) =>
          prev.map((conv) =>
            conv._id?.toString() === conversationId?.toString() ||
            conv.lastMessage?._id?.toString() === deletedMessageId
              ? {
                  ...conv,
                  lastMessage:
                    conv.lastMessage?._id?.toString() === deletedMessageId
                      ? {
                          ...conv.lastMessage,
                          message: "This message was deleted",
                          deletedForEveryone: true,
                          integrityStatus: "warning",
                        }
                      : conv.lastMessage,
                }
              : conv
          )
        );
      });

      // ── Presence ─────────────────────────────────────────────────────────
      socket.on("userOnline", ({ userId }) => {
        setOnlineUsers((prev) => new Set([...prev, userId.toString()]));
      });

      socket.on("userOffline", ({ userId, lastSeen: ls }) => {
        setOnlineUsers((prev) => {
          const next = new Set(prev);
          next.delete(userId.toString());
          return next;
        });
        if (ls) {
          setLastSeen((prev) => ({ ...prev, [userId.toString()]: ls }));
        }
      });

      socket.on("onlineUsers", (userIds) => {
        setOnlineUsers(new Set(userIds.map((id) => id.toString())));
      });

      // ── Typing indicators ─────────────────────────────────────────────────
      socket.on("typing", ({ fromUserId }) => {
        setTypingUsers((prev) => ({ ...prev, [fromUserId.toString()]: true }));
      });

      socket.on("stopTyping", ({ fromUserId }) => {
        setTypingUsers((prev) => {
          const next = { ...prev };
          delete next[fromUserId.toString()];
          return next;
        });
      });
    }

    registerListeners(getSocket());

    // Keep checking in case AuthContext replaces the socket instance later.
    const interval = setInterval(() => {
      registerListeners(getSocket());
    }, 300);

    return () => {
      clearInterval(interval);
      detachListeners();
    };
  }, []);

  // ── Load conversation list on mount ───────────────────────────────────────
  useEffect(() => {
    getConversations()
      .then((data) => setConversations(Array.isArray(data) ? data : []))
      .catch((e) => console.error("[ChatContext] getConversations error:", e));
  }, []);

  useEffect(() => {
    const unreadTotal = conversations.reduce((sum, conv) => sum + (conv.unreadCount || 0), 0);
    document.title = unreadTotal > 0 ? `(${unreadTotal}) SecureChat` : "SecureChat";
  }, [conversations]);

  // ── setActiveChat: emit conversationRead when opening a chat ──────────────
  const setActiveChat = useCallback((chatPartner) => {
    activeChatRef.current = chatPartner;
    setActiveChatRaw(chatPartner);

    const chatPartnerId = chatPartner?._id?.toString();
    if (!chatPartnerId) return;

    // Emit conversationRead so the server marks all messages as read
    // and emits blue tick events back to the sender
    const socket = getSocket();
    if (socket && socket.connected) {
      // Find the conversationId for this chat partner
      setConversations((prev) => {
        const conv = prev.find(
          (c) => c.participant?._id?.toString() === chatPartnerId
        );
        if (conv?._id) {
          socket.emit("conversationRead", {
            conversationId: conv._id,
            toUserId: chatPartnerId,
          });
        }
        return prev.map((item) =>
          item.participant?._id?.toString() === chatPartnerId
            ? { ...item, unreadCount: 0 }
            : item
        );
      });
    }
  }, []);

  // ── Typing emit helpers ────────────────────────────────────────────────────
  const emitTyping = useCallback((toUserId) => {
    const socket = getSocket();
    if (socket && socket.connected && toUserId) {
      socket.emit("typing", { toUserId });
    }
  }, []);

  const emitStopTyping = useCallback((toUserId) => {
    const socket = getSocket();
    if (socket && socket.connected && toUserId) {
      socket.emit("stopTyping", { toUserId });
    }
  }, []);

  // ── Message state helpers ─────────────────────────────────────────────────

  const setMessagesForChat = useCallback((chatId, msgsOrUpdater) => {
    setMessages((prev) => ({
      ...prev,
      [chatId]:
        typeof msgsOrUpdater === "function"
          ? msgsOrUpdater(prev[chatId] || [])
          : msgsOrUpdater,
    }));
  }, []);

  const addMessageToChat = useCallback((chatId, msg) => {
    setMessages((prev) => ({
      ...prev,
      [chatId]: [...(prev[chatId] || []), msg],
    }));
  }, []);

  /**
   * Update a single message in place (e.g. after decryption, status change).
   */
  const updateMessageInChat = useCallback((chatId, messageId, updates) => {
    setMessages((prev) => {
      if (!prev[chatId]) return prev;
      return {
        ...prev,
        [chatId]: prev[chatId].map((m) =>
          m._id?.toString() === messageId?.toString()
            ? { ...m, ...updates }
            : m
        ),
      };
    });
  }, []);

  /**
   * Update the conversation list after sending a message
   * so the sidebar reflects the latest message immediately.
   */
  const updateConversationLastMessage = useCallback((chatId, message) => {
    setConversations((prev) => {
      const idx = prev.findIndex(
        (c) => c.participant?._id?.toString() === chatId.toString()
      );
      if (idx === -1) {
        return [
          {
            _id: message.conversation || `local_${chatId}`,
            participant: activeChatRef.current && activeChatRef.current._id?.toString() === chatId.toString()
              ? activeChatRef.current
              : { _id: chatId, displayName: "Unknown contact" },
            lastMessage: message,
            updatedAt: message.createdAt || new Date().toISOString(),
            unreadCount: 0,
            isPinned: false,
            isArchived: false,
          },
          ...prev,
        ];
      }
      const updated = [...prev];
      const [conv] = updated.splice(idx, 1);
      return [
        {
          ...conv,
          lastMessage: message,
          updatedAt: message.createdAt || new Date().toISOString(),
          isArchived: false,
        },
        ...updated,
      ];
    });
  }, []);

  const updateConversationMeta = useCallback((chatId, updates) => {
    setConversations((prev) =>
      prev.map((conv) =>
        conv.participant?._id?.toString() === chatId?.toString()
          ? { ...conv, ...updates }
          : conv
      )
    );
  }, []);

  const removeConversation = useCallback((chatId) => {
    const normalizedChatId = chatId?.toString();
    if (!normalizedChatId) return;

    setConversations((prev) =>
      prev.filter(
        (conv) => conv.participant?._id?.toString() !== normalizedChatId
      )
    );

    setMessages((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, normalizedChatId)) {
        return prev;
      }

      const next = { ...prev };
      delete next[normalizedChatId];
      return next;
    });

    if (activeChatRef.current?._id?.toString() === normalizedChatId) {
      activeChatRef.current = null;
      setActiveChatRaw(null);
    }
  }, []);

  return (
    <ChatContext.Provider
      value={{
        messages,
        activeChat,
        setActiveChat,
        conversations,
        setConversations,
        typingUsers,
        onlineUsers,
        lastSeen,
        setOnlineUsers,
        securityPanel,
        setSecurityPanel,
        setMessagesForChat,
        addMessageToChat,
        updateMessageInChat,
        updateConversationLastMessage,
        updateConversationMeta,
        removeConversation,
        emitTyping,
        emitStopTyping,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  return useContext(ChatContext);
}
