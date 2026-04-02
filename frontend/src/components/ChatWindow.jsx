import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { clearChat, deleteMessage, deleteMessageForEveryone, getMessages, sendMessage, toggleStarMessage } from "../services/messageService";
import { getPublicKey } from "../services/userService";
import { reportSecurityEvent as reportSecEvent } from "../services/securityService";
import { askAI } from "../services/aiService";
import MessageItem from "./MessageItem";
import {
  aesEncrypt,
  aesDecrypt,
  encryptWithPublicKey,
  decryptWithPrivateKey,
  importPublicKeyPem,
  importSigningPublicKeyPem,
  sha256Hex,
  signData,
  verifySignature,
} from "../crypto/keyUtils";

const AI_CHAT_ID = "ai-assistant";

/*
  ARCHITECTURE NOTES
  ──────────────────
  • activeChat is the OTHER user's object { _id, displayName, email, publicKey, ... }
  • chatId = activeChat._id (the other user's MongoDB _id)
  • Message state is keyed by chatId in ChatContext: messages[chatId]
  • Decryption happens here, never in ChatContext
  • _needsDecrypt flag is set by ChatContext on incoming real-time messages
  • decryptedIds ref prevents the infinite decrypt → setState → re-render loop
  • @AI messages are sent as plaintext to /api/ai/chat — never encrypted,
    never stored in MongoDB, clearly labelled as unencrypted in the UI
*/

// ── AI message helpers ────────────────────────────────────────────────────────

const AI_PREFIX_REGEX = /^@[Aa][Ii]\s+/;

function isAIMessage(text) {
  return AI_PREFIX_REGEX.test(text.trim());
}

function stripAIPrefix(text) {
  return text.trim().replace(AI_PREFIX_REGEX, "").trim();
}

/** Build a unique local ID for optimistic messages (no DB round-trip yet) */
function localId() {
  return `local_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function buildReplyPayload(message) {
  if (!message?._id) return null;
  return {
    messageId: message._id,
    sender: message.sender,
    preview: message.message || "Encrypted message",
  };
}

function formatLastSeen(activeChat, isTyping, isAIChat, onlineUsers, lastSeen) {
  if (isAIChat) return "Assistant chat";
  if (isTyping) return "typing...";
  const id = activeChat?._id?.toString();
  if (!id) return "End-to-end encrypted";
  if (onlineUsers.has(id)) return "Online";
  const seenAt = lastSeen[id] || activeChat?.lastSeen;
  if (!seenAt) return "Offline";
  return `Last seen ${new Date(seenAt).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export default function ChatWindow({ onViewProfile, isMobile = false, onBack }) {
  const { user, privateKey, signingKey }    = useAuth();
  const {
    activeChat,
    messages,
    setMessagesForChat,
    updateMessageInChat,
    updateConversationLastMessage,
    setConversations,
    typingUsers,
    onlineUsers,
    lastSeen,
    emitTyping,
    emitStopTyping,
  } = useChat();

  const [input, setInput]       = useState("");
  const [sending, setSending]   = useState(false);
  const [loading, setLoading]   = useState(false);
  const [aiTyping, setAiTyping] = useState(false);
  const [menuState, setMenuState] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [starredOnly, setStarredOnly] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);

  // Tracks per-AI-chat conversation history for context
  // { [chatId]: [{ role, content }] }
  const aiHistoryRef = useRef({});

  // Track which message IDs have already been decrypted to prevent
  // the infinite loop: decrypt → setMessages → re-render → decrypt again
  const decryptedIds  = useRef(new Set());
  const bottomRef     = useRef(null);
  const typingTimeout = useRef(null);
  const inputRef      = useRef(null);
  const menuRef       = useRef(null);

  const chatId       = activeChat?._id?.toString();
  const isAIChat     = chatId === AI_CHAT_ID || activeChat?._isAI;
  const chatMessages = (chatId && messages[chatId]) || [];
  const visibleMessages = starredOnly ? chatMessages.filter((msg) => msg.starred) : chatMessages;
  const isTyping     = !!(!isAIChat && chatId && typingUsers[chatId]);
  const recipientName =
    activeChat?.username || activeChat?.displayName || activeChat?.email || activeChat?.phone || "Unknown";
  const recipientStatus = formatLastSeen(activeChat, isTyping, isAIChat, onlineUsers, lastSeen);

  // ── Decrypt a single raw message ─────────────────────────────────────────
  const decryptMsg = useCallback(
    async (raw) => {
      if (raw.deletedForEveryone) {
        return {
          ...raw,
          message: raw.message || "This message was deleted",
          _decrypted: true,
          _needsDecrypt: false,
        };
      }
      if (!privateKey || !raw.encryptedKey || !raw.ciphertext) {
        return {
          ...raw,
          message:       "[🔒 Private key unavailable — re-login to decrypt]",
          _decrypted:    true,
          _needsDecrypt: false,
        };
      }
      try {
        const aesKeyBuf   = await decryptWithPrivateKey(raw.encryptedKey, privateKey);
        const aesKeyBytes = new Uint8Array(aesKeyBuf);
        const plaintext   = await aesDecrypt(raw.ciphertext, raw.iv, raw.authTag, aesKeyBytes);

        // -- Optional Signature Verification (Identity Proof) --
        let signatureValid = raw.signatureValid;
        const senderPubKey = (raw.sender === activeChat?._id) ? activeChat?.signingPublicKey : null;

        if (raw.signature && senderPubKey && raw.signature !== raw.fingerprint) {
          try {
            const pubKey = await importSigningPublicKeyPem(senderPubKey);
            signatureValid = await verifySignature(pubKey, raw.ciphertext, raw.signature);
          } catch (sigErr) {
            console.warn("[ChatWindow] Signature verification error:", sigErr);
          }
        }

        return {
          ...raw,
          message: plaintext,
          _decrypted: true,
          _needsDecrypt: false,
          signatureValid: signatureValid ?? raw.signatureValid
        };
      } catch (e) {
        console.warn("[ChatWindow] Decryption failed for", raw._id, ":", e.message);

        // Report to backend security monitor if decryption failed locally
        if (raw._id) {
          reportSecEvent("TAMPER_DETECTED", "Client-side decryption failed (potential DB compromise)", {
            messageId: raw._id,
            error: e.message
          }).catch(console.error);
        }

        return {
          ...raw,
          message:        "[⚠ Decryption failed]",
          _decrypted:     true,
          _decryptFailed: true,
          _needsDecrypt:  false,
          integrityStatus: "tampered",
          integrityScore:  0,
          signatureValid:  false,
          fingerprintValid: false,
          authTagValid:    false,
        };
      }
    },
    [privateKey]
  );

  // ── Load + decrypt history when active chat changes ───────────────────────
  useEffect(() => {
    if (!chatId) return;
    if (isAIChat) {
      setReplyingTo(null);
      setStarredOnly(false);
      decryptedIds.current = new Set(
        (messages[chatId] || []).map((m) => m._id?.toString()).filter(Boolean)
      );
      setLoading(false);
      return;
    }
    decryptedIds.current = new Set();
    setReplyingTo(null);
    setStarredOnly(false);
    setLoading(true);

    getMessages(chatId)
      .then(async (data) => {
        if (!Array.isArray(data)) return;
        const decrypted = await Promise.all(data.map((msg) => decryptMsg(msg)));
        decrypted.forEach((m) => {
          if (m._id) decryptedIds.current.add(m._id.toString());
        });
        setMessagesForChat(chatId, decrypted);
      })
      .catch((err) => console.error("[ChatWindow] getMessages error:", err))
      .finally(() => setLoading(false));
  }, [chatId, isAIChat]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Decrypt incoming real-time messages ───────────────────────────────────
  useEffect(() => {
    if (!chatId) return;
    const pending = chatMessages.filter(
      (m) => m._needsDecrypt && m._id && !decryptedIds.current.has(m._id.toString())
    );
    if (pending.length === 0) return;

    pending.forEach((m) => decryptedIds.current.add(m._id.toString()));

    (async () => {
      await Promise.all(
        pending.map(async (m) => {
          const decrypted = await decryptMsg(m);
          updateMessageInChat(chatId, m._id, {
            message:        decrypted.message,
            _decrypted:     true,
            _decryptFailed: decrypted._decryptFailed || false,
            _needsDecrypt:  false,
          });
        })
      );
    })();
  }, [chatMessages]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages.length, isTyping, aiTyping]);

  useEffect(() => {
    function closeMenu() {
      setMenuState(null);
    }

    function closeMenuOnPointerDown(event) {
      if (event.button === 2) return;
      if (menuRef.current?.contains(event.target)) return;
      closeMenu();
    }

    window.addEventListener("pointerdown", closeMenuOnPointerDown);
    window.addEventListener("scroll", closeMenu, true);

    return () => {
      window.removeEventListener("pointerdown", closeMenuOnPointerDown);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, []);

  // ── Clean up typing on chat change ────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (chatId) {
        clearTimeout(typingTimeout.current);
        emitStopTyping(chatId);
      }
    };
  }, [chatId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Input handler ─────────────────────────────────────────────────────────
  function handleInputChange(e) {
    setInput(e.target.value);
    if (!chatId || isAIChat) return;
    emitTyping(chatId);
    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => emitStopTyping(chatId), 1500);
  }

  // ── AI send path ──────────────────────────────────────────────────────────
  async function handleAISend(rawText) {
    const query = isAIChat ? rawText.trim() : stripAIPrefix(rawText);
    if (!query) return;

    const id = chatId;

    // 1. Show the user's @AI message immediately
    const userMsgId = localId();
    const userMsg = {
      _id:             userMsgId,
      sender:          user._id,
      receiver:        id,
      message:         rawText,
      integrityStatus: "ai",
      integrityScore:  null,
      createdAt:       new Date().toISOString(),
      status:          "sent",
      _decrypted:      true,
      _needsDecrypt:   false,
      _isAI:           true,
    };
    decryptedIds.current.add(userMsgId);
    setMessagesForChat(id, [...chatMessages, userMsg]);

    // 2. Show AI typing indicator
    setAiTyping(true);

    try {
      // 3. Build context from previous AI exchanges in this chat
      const history = aiHistoryRef.current[id] || [];

      const { reply } = await askAI(query, history);

      // 4. Update AI history for next turn (keep last 6 messages = 3 turns)
      const updatedHistory = [
        ...history,
        { role: "user",      content: query },
        { role: "assistant", content: reply },
      ].slice(-6);
      aiHistoryRef.current[id] = updatedHistory;

      // 5. Inject AI reply bubble
      const aiMsgId = localId();
      const aiMsg = {
        _id:             aiMsgId,
        sender:          "ai",
        receiver:        user._id,
        message:         reply,
        integrityStatus: "ai",
        integrityScore:  null,
        createdAt:       new Date().toISOString(),
        status:          "read",
        _decrypted:      true,
        _needsDecrypt:   false,
        _isAI:           true,
      };
      decryptedIds.current.add(aiMsgId);

      setMessagesForChat(id, (current) => [...current, aiMsg]);
    } catch (err) {
      // Replace the pending user message with an error state
      const reason =
        err?.message?.trim() && err.message !== "Request failed"
          ? err.message
          : "AI is unavailable right now. Please try again.";
      const errMsg = {
        _id:             localId(),
        sender:          "ai",
        receiver:        user._id,
        message:         reason.includes("Rate limit")
          ? "⚠ Rate limit reached — please wait a moment before asking again."
          : `⚠ ${reason}`,
        integrityStatus: "ai",
        integrityScore:  null,
        createdAt:       new Date().toISOString(),
        status:          "read",
        _decrypted:      true,
        _needsDecrypt:   false,
        _isAI:           true,
      };
      decryptedIds.current.add(errMsg._id);
      setMessagesForChat(id, (current) => [...current, errMsg]);
    } finally {
      setAiTyping(false);
    }
  }

  // ── Encrypted send path ───────────────────────────────────────────────────
  async function handleEncryptedSend(text) {
    // Step 1: AES-256-GCM encrypt
    const { ciphertext, iv, authTag, rawKey } = await aesEncrypt(text);

    // Step 2: SHA-256 fingerprint
    const fingerprint = await sha256Hex(ciphertext);

    // Step 3: Fetch receiver's RSA public key
    const pkRes = await getPublicKey(chatId);
    if (!pkRes?.publicKey) throw new Error("Receiver has no public key registered");
    const receiverCryptoKey = await importPublicKeyPem(pkRes.publicKey);

    // Step 4: Encrypt AES key with receiver's public key
    const encryptedKey = await encryptWithPublicKey(rawKey, receiverCryptoKey);

    // Step 5: Encrypt AES key with sender's own public key
    let senderEncryptedKey = null;
    if (user.publicKey) {
      const senderCryptoKey = await importPublicKeyPem(user.publicKey);
      senderEncryptedKey    = await encryptWithPublicKey(rawKey, senderCryptoKey);
    }

    // Step 6: Signature (RSA-PSS identity proof)
    let signature = fingerprint;
    if (signingKey) {
      try {
        signature = await signData(signingKey, ciphertext);
      } catch (sigErr) {
        console.error("[ChatWindow] Signing failed:", sigErr);
      }
    }
    const replyPayload = replyingTo ? buildReplyPayload(replyingTo) : null;

    // Step 7: POST to backend
    const res = await sendMessage({
      receiverId: chatId,
      ciphertext,
      encryptedKey,
      senderEncryptedKey,
      iv,
      authTag,
      fingerprint,
      signature,
      replyTo: replyPayload,
    });

    // Step 8: Optimistic render
    if (res?.data) {
      const sentMessage = {
        _id:              res.data._id,
        conversation:     res.data.conversation,
        sender:           user._id,
        receiver:         chatId,
        message:          text,
        encryptedKey:     senderEncryptedKey,
        ciphertext,
        iv,
        authTag,
        fingerprint,
        signature,
        integrityScore:   res.data.integrityScore  ?? 100,
        integrityStatus:  res.data.integrityStatus ?? "secure",
        signatureValid:   res.data.signatureValid  ?? true,
        fingerprintValid: res.data.fingerprintValid ?? true,
        authTagValid:     res.data.authTagValid     ?? true,
        starred:          false,
        replyTo:          res.data.replyTo || replyPayload,
        createdAt:        res.data.createdAt || new Date().toISOString(),
        status:           "sent",
        _decrypted:       true,
        _needsDecrypt:    false,
      };

      if (res.data._id) decryptedIds.current.add(res.data._id.toString());
      setMessagesForChat(chatId, [...chatMessages, sentMessage]);
      updateConversationLastMessage(chatId, sentMessage);
      setReplyingTo(null);
    }
  }

  // ── Main send handler ─────────────────────────────────────────────────────
  async function handleSend(e) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || !chatId || sending) return;

    setInput("");
    setSending(true);
    clearTimeout(typingTimeout.current);
    emitStopTyping(chatId);

    try {
      if (isAIChat || isAIMessage(text)) {
        // AI path — no encryption, no private key required
        await handleAISend(text);
        setReplyingTo(null);
      } else {
        // Encrypted path — requires private key
        if (!privateKey) {
          setInput(text);
          return;
        }
        await handleEncryptedSend(text);
      }
    } catch (err) {
      console.error("[ChatWindow] Send error:", err.message);
      setInput(text);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleMessageContextMenu(e, message) {
    if (!message?._id) return;
    e.preventDefault();
    e.stopPropagation();
    setMenuState({
      x: e.clientX,
      y: e.clientY,
      message,
      canReply: !message.deletedForEveryone,
      canStar: !String(message._id).startsWith("local_"),
      canDeleteForEveryone:
        !isAIChat &&
        !String(message._id).startsWith("local_") &&
        !message.deletedForEveryone &&
        message.sender?.toString() === user._id?.toString(),
    });
  }

  function handleReplyMessage(message) {
    setMenuState(null);
    setReplyingTo(message);
    inputRef.current?.focus();
  }

  async function handleToggleStar(message) {
    if (!chatId || !message?._id || String(message._id).startsWith("local_")) return;
    setMenuState(null);

    try {
      const res = await toggleStarMessage(message._id);
      updateMessageInChat(chatId, message._id, { starred: !!res?.starred });
    } catch (err) {
      console.error("[ChatWindow] Star message error:", err);
      alert(err?.error || "Failed to update starred state");
    }
  }

  async function handleDeleteMessage(message) {
    if (!chatId || !message?._id) return;
    setMenuState(null);
    setConfirmDialog({
      title: "Delete Message",
      message: "Delete this message for you?",
      danger: true,
      onConfirm: async () => {
        setConfirmDialog(null);

        const currentMessages = chatMessages;
        const nextMessages = currentMessages.filter((m) => m._id?.toString() !== message._id?.toString());
        const fallbackLastMessage = nextMessages[nextMessages.length - 1] || null;

        // Local AI / optimistic-only messages are removed client-side only.
        if (isAIChat || String(message._id).startsWith("local_")) {
          setMessagesForChat(chatId, nextMessages);
          setConversations((prev) =>
            prev.map((conv) =>
              conv.participant?._id?.toString() === chatId
                ? {
                    ...conv,
                    lastMessage: fallbackLastMessage,
                    updatedAt: fallbackLastMessage?.createdAt || conv.updatedAt,
                  }
                : conv
            )
          );
          return;
        }

        try {
          const res = await deleteMessage(message._id);

          setMessagesForChat(chatId, nextMessages);
          setConversations((prev) =>
            prev.map((conv) =>
              conv.participant?._id?.toString() === chatId
                ? {
                    ...conv,
                    lastMessage: res?.lastMessage || fallbackLastMessage,
                    updatedAt:
                      res?.lastMessage?.createdAt ||
                      fallbackLastMessage?.createdAt ||
                      conv.updatedAt,
                  }
                : conv
            )
          );
        } catch (err) {
          console.error("[ChatWindow] Delete error:", err);
          alert(err?.error || "Failed to delete message");
        }
      }
    });
  }

  async function handleDeleteMessageForEveryone(message) {
    if (!chatId || !message?._id) return;
    setMenuState(null);
    setConfirmDialog({
      title: "Delete For Everyone",
      message: "Delete this message for everyone?",
      danger: true,
      onConfirm: async () => {
        setConfirmDialog(null);

        try {
          await deleteMessageForEveryone(message._id);
          setMessagesForChat(chatId, (current) =>
            current.map((m) =>
              m._id?.toString() === message._id?.toString()
                ? {
                    ...m,
                    message: "This message was deleted",
                    deletedForEveryone: true,
                    ciphertext: null,
                    encryptedKey: null,
                    iv: null,
                    authTag: null,
                    fingerprint: null,
                    signature: null,
                    integrityStatus: "warning",
                    _decrypted: true,
                    _needsDecrypt: false,
                  }
                : m
            )
          );
          setConversations((prev) =>
            prev.map((conv) =>
              conv.participant?._id?.toString() === chatId
                ? {
                    ...conv,
                    lastMessage:
                      conv.lastMessage?._id?.toString() === message._id?.toString()
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
        } catch (err) {
          console.error("[ChatWindow] Delete for everyone error:", err);
          alert(err?.error || "Failed to delete message for everyone");
        }
      }
    });
  }

  function handleClearChat() {
    if (!chatId || isAIChat) return;
    setConfirmDialog({
      title: "Clear Chat",
      message: `Clear the chat with ${recipientName}? This removes all messages for you.`,
      danger: true,
      onConfirm: async () => {
        setConfirmDialog(null);
        try {
          const res = await clearChat(chatId);
          setMessagesForChat(chatId, []);
          setConversations((prev) =>
            prev.map((conv) =>
              conv.participant?._id?.toString() === chatId
                ? {
                    ...conv,
                    lastMessage: null,
                    unreadCount: 0,
                    updatedAt: res?.updatedAt || new Date().toISOString(),
                  }
                : conv
            )
          );
          setReplyingTo(null);
          setMenuState(null);
        } catch (err) {
          console.error("[ChatWindow] Clear chat error:", err);
          alert(err?.error || "Failed to clear chat");
        }
      }
    });
  }

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!activeChat) {
    return (
      <div className="chat-surface chat-window-empty" style={{
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        gap: 24,
      }}>
        {/* Glow badge */}
        <div style={{
          width: 80, height: 80, borderRadius: 24,
          background: "var(--bg-3)",
          border: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 34,
          boxShadow: "var(--shadow-soft)",
        }}>
          🔐
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "var(--text-primary)", fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
            Select a contact to start chatting
          </div>
          <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>
            All conversations are end-to-end encrypted
          </div>
        </div>
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10,
          maxWidth: 360, width: "100%",
        }}>
          {[
            { icon: "🔒", label: "AES-256-GCM", sub: "message encryption" },
            { icon: "🔑", label: "RSA-2048",     sub: "key exchange" },
            { icon: "🛡",  label: "SHA-256",      sub: "fingerprinting" },
            { icon: "🤖", label: "SecureChat AI", sub: "ask anything" },
          ].map(({ icon, label, sub }) => (
            <div key={label} style={{
              padding: "14px 14px",
              borderRadius: 18,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              display: "flex", flexDirection: "column", gap: 4,
            }}>
              <span style={{ fontSize: 20 }}>{icon}</span>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{label}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{sub}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Main chat view ────────────────────────────────────────────────────────
  return (
    <div
      className="chat-surface chat-window-layout"
      onContextMenu={(e) => e.preventDefault()}
      style={{
        flex: 1, display: "flex", flexDirection: "column",
        height: "100%", overflow: "hidden", position: "relative",
      }}
    >

      {/* ── Header ── */}
      <div className="chat-window-header" style={{
        padding: isMobile ? "12px 14px" : "14px 20px", borderBottom: "1px solid var(--border)",
        background: "var(--bg-1)", display: "flex",
        alignItems: "center", gap: 12, flexShrink: 0,
      }}>
        {isMobile && (
          <button
            type="button"
            onClick={onBack}
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: "var(--bg-3)",
              color: "var(--text-primary)",
              fontSize: 18,
              flexShrink: 0,
            }}
          >
            ←
          </button>
        )}
        {/* Avatar with optional online dot */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <div style={{
            width: 40, height: 40, borderRadius: "50%",
            background: isAIChat
              ? "linear-gradient(135deg, rgba(127,119,221,0.4), rgba(138,180,255,0.3))"
              : `hsl(${(recipientName.charCodeAt(0) * 13) % 360}, 50%, 28%)`,
            border: isAIChat
              ? "1.5px solid rgba(127,119,221,0.4)"
              : `1.5px solid hsl(${(recipientName.charCodeAt(0) * 13) % 360}, 40%, 18%)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: isAIChat ? 18 : 16, fontWeight: 700,
            color: isAIChat ? "#a89fef" : `hsl(${(recipientName.charCodeAt(0) * 13) % 360}, 70%, 75%)`,
          }}>
            {isAIChat ? "🤖" : (activeChat?.avatar && /\p{Emoji}/u.test(activeChat.avatar)
              ? activeChat.avatar
              : (recipientName[0] || "?").toUpperCase())}
          </div>
          {!isAIChat && onlineUsers.has(chatId) && (
            <div style={{
              position: "absolute", bottom: -2, right: -2,
              width: 12, height: 12, borderRadius: "50%",
              background: "#7a9a5e",
              border: "2px solid var(--bg-1)",
            }} />
          )}
        </div>
        <button
          type="button"
          onClick={() => !isAIChat && onViewProfile?.(chatId)}
          style={{
            background: "transparent",
            color: "inherit",
            textAlign: "left",
            cursor: isAIChat ? "default" : "pointer",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 15 }}>{recipientName}</div>
          <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
            {isAIChat ? <span style={{ color: "#7f77dd" }}>{recipientStatus}</span> : recipientStatus}
          </div>
        </button>
        <div className="chat-window-header__actions" style={{
          marginLeft: "auto", display: "flex",
          gap: 6, flexWrap: "wrap", justifyContent: "flex-end",
          maxWidth: isMobile ? "42%" : "none",
        }}>
          {isAIChat ? (
            <span style={{
              fontSize: 10, fontFamily: "var(--font-mono)",
              color: "#a89fef", background: "rgba(127,119,221,0.1)",
              padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(127,119,221,0.2)"
            }}>PLAIN AI CHAT</span>
          ) : (
            <>
              <button
                type="button"
                onClick={handleClearChat}
                style={{
                  fontSize: 10,
                  fontFamily: "var(--font-accent)",
                  fontWeight: 700,
                  letterSpacing: "0.03em",
                  color: "var(--danger)",
                  background: "var(--danger-dim)",
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: "1px solid rgba(224, 106, 106, 0.15)",
                }}
              >
                CLEAR CHAT
              </button>
              <button
                type="button"
                onClick={() => setStarredOnly((value) => !value)}
                style={{
                  fontSize: 10,
                  fontFamily: "var(--font-accent)",
                  fontWeight: 700,
                  letterSpacing: "0.03em",
                  color: starredOnly ? "var(--bg-1)" : "var(--warn)",
                  background: starredOnly ? "var(--warn)" : "rgba(220, 165, 86, 0.1)",
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: "1px solid rgba(220, 165, 86, 0.15)",
                }}
              >
                {starredOnly ? "ALL" : "STARRED"}
              </button>
               <span style={{
                fontSize: 10, fontFamily: "var(--font-accent)", fontWeight: 700, letterSpacing: "0.03em",
                color: "var(--accent)", background: "var(--sent-bg)",
                padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border-active)"
              }}>AES-256-GCM</span>
               <span style={{
                fontSize: 10, fontFamily: "var(--font-accent)", fontWeight: 700, letterSpacing: "0.03em",
                color: "var(--info)", background: "rgba(132, 154, 101, 0.1)",
                padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(132, 154, 101, 0.2)"
              }}>RSA-2048</span>
            </>
          )}
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="chat-window-messages" style={{
        flex: 1, overflowY: "auto", padding: isMobile ? "12px 12px 16px" : "16px 20px",
        display: "flex", flexDirection: "column", gap: 2,
        WebkitOverflowScrolling: "touch",
      }}>
        {loading && (
          <div style={{
            textAlign: "center", color: "var(--text-muted)",
            padding: 40, fontFamily: "var(--font-mono)", fontSize: 12,
          }}>
            🔓 Decrypting messages...
          </div>
        )}

        {!loading && chatMessages.length === 0 && (
          <div style={{
            textAlign: "center", color: "var(--text-muted)",
            padding: 40, fontSize: 13, lineHeight: 2,
          }}>
            No messages yet<br />
            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
              {isAIChat
                ? "Chat with SecureChat AI here. Messages are not encrypted."
                : "Messages are end-to-end encrypted · Type @AI to ask the assistant"}
            </span>
          </div>
        )}

        {visibleMessages.map((msg, i) => (
          <MessageItem
            key={msg._id || i}
            msg={msg}
            isMine={
              msg.sender === "ai"
                ? false
                : msg.sender?.toString() === user._id?.toString()
            }
            onContextMenu={handleMessageContextMenu}
          />
          ))}

        {!loading && starredOnly && visibleMessages.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--text-muted)", padding: 24, fontSize: 13 }}>
            No starred messages in this chat
          </div>
        )}

        {/* AI typing indicator */}
        {aiTyping && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              background: "linear-gradient(135deg, #7f77dd, #1d9e75)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, color: "#fff", flexShrink: 0,
            }}>
              AI
            </div>
            <div style={{
              background: "var(--bg-3)", borderRadius: "16px 16px 16px 4px",
              padding: "10px 16px", display: "flex", gap: 4, alignItems: "center",
            }}>
              {[0, 1, 2].map((j) => (
                <div key={j} style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: "#7f77dd",
                  animation: `pulse 1.2s infinite ${j * 0.2}s`,
                }} />
              ))}
            </div>
          </div>
        )}

        {/* Human typing indicator */}
        {isTyping && (
          <div style={{ display: "flex", alignItems: "center", padding: "4px 0" }}>
            <div style={{
              background: "var(--bg-3)", borderRadius: "16px 16px 16px 4px",
              padding: "10px 16px", display: "flex", gap: 4, alignItems: "center",
            }}>
              {[0, 1, 2].map((j) => (
                <div key={j} style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: "var(--text-secondary)",
                  animation: `pulse 1.2s infinite ${j * 0.2}s`,
                }} />
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {menuState && createPortal(
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100000,
            pointerEvents: "none",
          }}
        >
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              top: Math.max(8, Math.min(menuState.y, window.innerHeight - 160)),
              left: Math.max(8, Math.min(menuState.x, window.innerWidth - 190)),
              background: "#1b1f24",
              color: "#f5f7fa",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 10,
              boxShadow: "0 20px 45px rgba(0,0,0,0.35)",
              zIndex: 100001,
              minWidth: 180,
              overflow: "hidden",
              pointerEvents: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
          {menuState.canReply && (
            <button
              type="button"
              onClick={() => handleReplyMessage(menuState.message)}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                color: "#f5f7fa",
                textAlign: "left",
                padding: "12px 14px",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Reply
            </button>
          )}
          {menuState.canStar && (
            <button
              type="button"
              onClick={() => handleToggleStar(menuState.message)}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                color: "#f0c36d",
                textAlign: "left",
                padding: "12px 14px",
                fontSize: 13,
                cursor: "pointer",
                borderTop: menuState.canReply ? "1px solid rgba(255,255,255,0.08)" : "none",
              }}
            >
              {menuState.message?.starred ? "Unstar message" : "Star message"}
            </button>
          )}
          <button
            type="button"
            onClick={() => handleDeleteMessage(menuState.message)}
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              color: "#ff8b8b",
              textAlign: "left",
              padding: "12px 14px",
              fontSize: 13,
              cursor: "pointer",
              borderTop: (menuState.canReply || menuState.canStar) ? "1px solid rgba(255,255,255,0.08)" : "none",
            }}
          >
            Delete for me
          </button>
          {menuState.canDeleteForEveryone && (
            <button
              type="button"
              onClick={() => handleDeleteMessageForEveryone(menuState.message)}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                color: "#f5f7fa",
                textAlign: "left",
                padding: "12px 14px",
                fontSize: 13,
                cursor: "pointer",
                borderTop: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              Delete for everyone
            </button>
          )}
          </div>
        </div>,
        document.body
      )}

      {/* ── Private key warning ── */}
      {!privateKey && !isAIChat && (
        <div style={{
          padding: "8px 20px", background: "rgba(255,170,0,0.1)",
          borderTop: "1px solid rgba(255,170,0,0.3)",
          fontSize: 12, color: "var(--warn)", fontFamily: "var(--font-mono)",
        }}>
          ⚠ Private key not loaded — encrypted messages cannot be sent or decrypted.
          Type @AI to use the assistant without encryption.
        </div>
      )}

      {/* ── Input ── */}
      <div className="chat-window-composer" style={{
        padding: isMobile ? "10px 12px calc(10px + env(safe-area-inset-bottom, 0px))" : "12px 20px", borderTop: "1px solid var(--border)",
        background: "var(--bg-1)", flexShrink: 0,
      }}>
        {replyingTo && (
          <div
            style={{
              marginBottom: 10,
              background: "var(--bg-2)",
              border: "1px solid var(--border)",
              borderLeft: "3px solid var(--accent)",
              borderRadius: 12,
              padding: "10px 12px",
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
                Replying to {replyingTo.sender?.toString() === user._id?.toString() ? "yourself" : recipientName}
              </div>
              <div
                style={{
                  color: "var(--text-secondary)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {replyingTo.message || "Encrypted message"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              style={{
                background: "transparent",
                color: "var(--text-muted)",
                fontSize: 14,
              }}
            >
              x
            </button>
          </div>
        )}

        <form onSubmit={handleSend} className="chat-window-composer__form" style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div className="chat-window-composer__input-shell" style={{
            flex: 1, background: "var(--bg-3)",
            border: `1px solid ${(isAIChat || isAIMessage(input)) ? "rgba(127,119,221,0.3)" : "var(--border)"}`,
            borderRadius: 10, padding: "10px 14px",
            transition: "border-color 0.2s",
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={
                isAIChat
                  ? `Ask ${recipientName} anything...`
                  : privateKey
                  ? `Message ${recipientName}… or type @AI <question>`
                  : "@AI is available · log in again for encrypted messaging"
              }
              disabled={sending}
              rows={1}
              style={{
                width: "100%", background: "none", border: "none",
                color: (isAIChat || isAIMessage(input)) ? "#a89fef" : "var(--text-primary)",
                fontSize: 14, resize: "none", outline: "none",
                lineHeight: 1.5, maxHeight: 100,
                fontFamily: "var(--font-sans)",
              }}
            />
          </div>

          <button
            type="submit"
            disabled={sending || !input.trim()}
            style={{
              width: 42, height: 42, borderRadius: 8, flexShrink: 0,
              background: sending || !input.trim()
                ? "var(--bg-4)"
                : (isAIChat || isAIMessage(input))
                  ? "rgba(127,119,221,0.8)"
                  : "var(--accent)",
              color: sending || !input.trim() ? "var(--text-muted)" : "var(--bg-0)",
              border: "none", fontSize: 18,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: sending || !input.trim() ? "default" : "pointer",
              transition: "all 0.2s", fontWeight: 700,
            }}
          >
            {sending ? "⟳" : isAIMessage(input) ? "🤖" : "↑"}
          </button>
        </form>

        <div style={{
          marginTop: 6, fontSize: 10, color: "var(--text-muted)",
          fontFamily: "var(--font-mono)",
          display: "flex", alignItems: "center", gap: 4,
        }}>
          {(isAIChat || isAIMessage(input)) ? (
            <>
              <span style={{ color: "#7f77dd" }}>🤖</span>
              AI reply is not encrypted · type @AI followed by your question
            </>
          ) : (
            <>
              <span style={{ color: "var(--accent)" }}>🔐</span>
              Messages encrypted in your browser before sending
            </>
          )}
        </div>
      </div>

      {/* ── Custom Confirm UI ── */}
      {confirmDialog && createPortal(
        <div className="modal-overlay" style={{
          position: "fixed", inset: 0, zIndex: 999999,
          background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center"
        }}>
          <div className="modal-content" style={{
            background: "var(--bg-1)", padding: 24, borderRadius: 16,
            border: "1px solid var(--border)", maxWidth: 320, width: "90%",
            boxShadow: "var(--shadow)", textAlign: "center", animation: "fadeIn 0.2s ease"
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: "var(--text-primary)" }}>{confirmDialog.title}</div>
            <div style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 24 }}>{confirmDialog.message}</div>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                style={{
                  flex: 1, padding: "10px 0", borderRadius: 8, background: "var(--bg-3)",
                  color: "var(--text-primary)", border: "1px solid var(--border)", fontWeight: 600,
                  cursor: "pointer", transition: "background 0.2s"
                }}
              >Cancel</button>
              <button
                type="button"
                onClick={confirmDialog.onConfirm}
                style={{
                  flex: 1, padding: "10px 0", borderRadius: 8,
                  background: confirmDialog.danger ? "var(--danger)" : "var(--accent)", color: "#fff",
                  border: "none", fontWeight: 600, cursor: "pointer", transition: "opacity 0.2s"
                }}
              >Confirm</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
