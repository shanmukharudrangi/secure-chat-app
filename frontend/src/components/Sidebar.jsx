import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { updateProfile } from "../services/userService";
import { deleteChat, toggleArchiveChat, togglePinChat } from "../services/messageService";
import { searchUsersByUsername } from "../services/userService";

const AI_CHAT = {
  _id: "ai-assistant",
  displayName: "SecureChat AI",
  avatar: "🤖",
  _isAI: true,
};

const AVATAR_OPTIONS = [
  "👤","😊","🦊","🐻","🐼","🦁","🐯","🦋","🌸","⚡","🔥","🌊",
];

/* ─── Helpers ─────────────────────────────────────────────────── */

function formatTime(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (new Date(now - 86_400_000).toDateString() === d.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/* ─── Sub-components ──────────────────────────────────────────── */

function SbAvatar({ name = "?", emoji = "", size = 46, online = false }) {
  const hue = name.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const raw =
    emoji ||
    name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() ||
    "?";
  const isEmoji = /\p{Emoji}/u.test(raw) && raw.length <= 2;

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <div
        style={{
          width: size, height: size, borderRadius: "50%",
          background: isEmoji ? "var(--sb-card)" : `hsl(${hue},45%,26%)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: isEmoji ? size * 0.5 : size * 0.36,
          fontWeight: isEmoji ? "normal" : 700,
          fontFamily: isEmoji ? "Segoe UI Emoji,Apple Color Emoji,Noto Color Emoji,sans-serif" : "inherit",
          color: isEmoji ? "unset" : `hsl(${hue},70%,76%)`,
          border: `2px solid ${isEmoji ? "rgba(255,255,255,0.08)" : `hsl(${hue},38%,18%)`}`,
          boxShadow: online ? "0 0 0 2px var(--sb-accent)" : "none",
          transition: "box-shadow 0.2s",
        }}
      >
        {raw}
      </div>
      {online && (
        <span
          style={{
            position: "absolute", bottom: 1, right: 1,
            width: size >= 40 ? 11 : 8, height: size >= 40 ? 11 : 8,
            background: "var(--sb-accent)", borderRadius: "50%",
            border: "2px solid var(--sb-bg)",
          }}
        />
      )}
    </div>
  );
}

function Icon({ children, size = 18, stroke = 2 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

function ActionBtn({ title, active = false, danger = false, onClick, children }) {
  return (
    <button
      type="button" title={title} aria-label={title} onClick={onClick}
      className={`sb-action${active ? " sb-action--active" : ""}${danger ? " sb-action--danger" : ""}`}
    >
      {children}
      <span className="sb-action__tip">{title}</span>
    </button>
  );
}

function ChatRow({ chat, isActive, unread, preview, timestamp, online, subtitle, pinned, onClick, onContextMenu }) {
  const name = chat.username || chat.displayName || chat.email || "Unknown";
  const sub  = chat.username ? chat.username : subtitle;
  return (
    <button
      type="button"
      className={`sb-chat-row${isActive ? " sb-chat-row--active" : ""}`}
      onClick={onClick} onContextMenu={onContextMenu}
    >
      <SbAvatar name={name} emoji={chat.avatar || ""} size={48} online={online} />
      <div className="sb-chat-row__body">
        <div className="sb-chat-row__top">
          <span className="sb-chat-row__name">
            {pinned && (
              <span className="sb-chat-row__pin" title="Pinned">
                <Icon size={11} stroke={2.4}>
                  <path d="M9 3l6 6"/><path d="M15 3l6 6"/><path d="M7 11l6 6"/><path d="M3 21l6-6"/>
                </Icon>
              </span>
            )}
            {name}
          </span>
          {timestamp && <span className="sb-chat-row__time">{formatTime(timestamp)}</span>}
        </div>
        <div className="sb-chat-row__bottom">
          <span className="sb-chat-row__preview">
            {preview || <em className="sb-chat-row__sub">{sub}</em>}
          </span>
          {unread > 0 && (
            <span className="sb-chat-row__badge">{unread > 99 ? "99+" : unread}</span>
          )}
        </div>
      </div>
    </button>
  );
}

/* ─── Inline Profile Editor ───────────────────────────────────── */

function ProfileEditor({ user, onClose, onSaved }) {
  const { updateUser } = useAuth();
  const [form, setForm] = useState({
    displayName: user?.displayName || "",
    username:    user?.username    || "",
    bio:         user?.bio         || "",
    avatar:      user?.avatar      || AVATAR_OPTIONS[0],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");

  function setField(k, v) { setForm(prev => ({ ...prev, [k]: v })); }

  async function handleSave(e) {
    e.preventDefault();
    const displayName = form.displayName.trim();
    const username    = form.username.trim();
    const bio         = form.bio.trim();
    if (!displayName) return setError("Display name is required");
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username))
      return setError("Username: 3-30 chars, letters/numbers/underscore");
    if (bio.length > 200) return setError("Bio max 200 chars");
    setSaving(true); setError("");
    try {
      const updated = await updateProfile({ displayName, username, avatar: form.avatar, bio });
      updateUser(updated);
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err?.error || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sb-editor">
      <div className="sb-editor__header">
        <span className="sb-editor__title">Edit Profile</span>
        <button type="button" className="sb-editor__close" onClick={onClose}>
          <Icon size={15} stroke={2.5}><path d="M18 6 6 18M6 6l12 12"/></Icon>
        </button>
      </div>

      <div className="sb-editor__scroll">
        {/* Avatar preview */}
        <div className="sb-editor__avatar-row">
          <SbAvatar name={form.displayName || "?"} emoji={form.avatar} size={64} online />
        </div>

        {/* Avatar picker */}
        <div className="sb-editor__section-label">Choose avatar</div>
        <div className="sb-editor__avatar-grid">
          {AVATAR_OPTIONS.map(em => (
            <button
              key={em} type="button"
              className={`sb-editor__av-btn${form.avatar === em ? " sb-editor__av-btn--active" : ""}`}
              onClick={() => setField("avatar", em)}
            >
              {em}
            </button>
          ))}
        </div>

        <form onSubmit={handleSave} style={{ display: "grid", gap: 14, marginTop: 16 }}>
          {error && (
            <div className="sb-editor__error">
              <Icon size={13}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></Icon>
              {error}
            </div>
          )}

          <div className="sb-editor__field">
            <label className="sb-editor__label">Display name</label>
            <input className="sb-editor__input" placeholder="Your name"
              value={form.displayName} maxLength={50}
              onChange={e => setField("displayName", e.target.value)} />
            <span className="sb-editor__count">{form.displayName.length}/50</span>
          </div>

          <div className="sb-editor__field">
            <label className="sb-editor__label">Username</label>
            <input className="sb-editor__input" placeholder="your_handle"
              value={form.username} maxLength={30}
              onChange={e => setField("username", e.target.value.replace(/[^a-zA-Z0-9_]/g,""))} />
            <span className="sb-editor__hint">{form.username || "handle"}</span>
          </div>

          <div className="sb-editor__field">
            <label className="sb-editor__label">Bio <em style={{ opacity: 0.55, fontStyle: "normal", fontSize: 10 }}>(optional)</em></label>
            <textarea className="sb-editor__textarea" placeholder="A short intro…" rows={2}
              value={form.bio} maxLength={200}
              onChange={e => setField("bio", e.target.value)} />
            <span className={`sb-editor__count${form.bio.length > 160 ? " sb-editor__count--warn" : ""}`}>
              {form.bio.length}/200
            </span>
          </div>

          <button type="submit" disabled={saving} className="sb-editor__save-btn">
            {saving ? "Saving…" : "Save changes"}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ─── Main Sidebar ────────────────────────────────────────────── */

export default function Sidebar({ isMobile = false }) {
  const [users, setUsers]             = useState([]);
  const [search, setSearch]           = useState("");
  const [loadingUsers, setLoadingU]   = useState(false);
  const [searchError, setSearchErr]   = useState("");
  const [chatMenu, setChatMenu]       = useState(null);
  const [showArchived, setShowArch]   = useState(false);
  const [editOpen, setEditOpen]       = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const { user, logout, theme, toggleTheme } = useAuth();
  const {
    activeChat, setActiveChat, conversations,
    onlineUsers, lastSeen, messages,
    updateConversationMeta, removeConversation,
    securityPanel, setSecurityPanel,
  } = useChat();

  const myName = user?.username || user?.displayName || user?.email || "Me";
  const normalizedSearch = search.trim().toLowerCase();

  /* ── User search (automatic based on input) ── */
  useEffect(() => {
    if (normalizedSearch.length < 2) { setUsers([]); setLoadingU(false); setSearchErr(""); return; }
    let cancelled = false;
    setLoadingU(true); setSearchErr("");
    const t = setTimeout(() => {
      searchUsersByUsername(normalizedSearch)
        .then(data => { if (!cancelled) setUsers(Array.isArray(data) ? data : []); })
        .catch(e  => { if (!cancelled) { setUsers([]); setSearchErr(e?.error || "Search failed"); } })
        .finally(() => { if (!cancelled) setLoadingU(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [normalizedSearch]);

  /* ── Close context menu on outside click ── */
  useEffect(() => {
    const close = () => setChatMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close, true); };
  }, []);

  /* ── Derived data ── */
  const conversationIds = useMemo(
    () => new Set(conversations.map(c => c.participant?._id?.toString()).filter(Boolean)),
    [conversations]
  );

  const filteredConversations = useMemo(() =>
    [...conversations]
      .filter(conv => {
        if (!conv.participant?._id) return false;
        if (!normalizedSearch) return true;
        const h = [conv.participant.displayName, conv.participant.username, conv.participant.email]
          .filter(Boolean).join(" ").toLowerCase();
        return h.includes(normalizedSearch);
      })
      .sort((a, b) => {
        if ((b.isPinned ? 1 : 0) !== (a.isPinned ? 1 : 0)) return (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0);
        return new Date(b.updatedAt) - new Date(a.updatedAt);
      }), [conversations, normalizedSearch]);

  const visibleConversations  = useMemo(() => filteredConversations.filter(c => !c.isArchived), [filteredConversations]);
  const archivedConversations = useMemo(() => filteredConversations.filter(c =>  c.isArchived), [filteredConversations]);

  const aiMessages    = messages[AI_CHAT._id] || [];
  const aiLastMessage = aiMessages[aiMessages.length - 1] || null;
  const aiUnread      = getUnread(AI_CHAT._id, messages, user);
  const aiIsActive    = activeChat?._id?.toString() === AI_CHAT._id;
  const aiMatchesSearch = !normalizedSearch || AI_CHAT.displayName.toLowerCase().includes(normalizedSearch);

  const availableUsers = useMemo(() => {
    const pool = users.filter(u => !conversationIds.has(u._id?.toString()));
    if (!normalizedSearch) return pool;
    return pool.filter(u => {
      const h = [u.username, u.displayName, u.email].filter(Boolean).join(" ").toLowerCase();
      return h.includes(normalizedSearch);
    });
  }, [users, conversationIds, normalizedSearch]);

  const visibleCount = visibleConversations.length + (aiMatchesSearch ? 1 : 0);
  const unreadChats  = visibleConversations.reduce((n, conv) => {
    const id = conv.participant?._id?.toString();
    return n + (getUnread(id, messages, user) > 0 ? 1 : 0);
  }, aiUnread > 0 ? 1 : 0);

  /* ── Handlers ── */
  function selectChat(chat) { setActiveChat(chat); setSearch(""); setUsers([]); setSearchErr(""); }

  function handleCtxMenu(e, participant) {
    if (!participant?._id || participant._isAI) return;
    e.preventDefault();
    setChatMenu({ x: e.clientX, y: e.clientY, participant,
      conversation: conversations.find(c => c.participant?._id?.toString() === participant._id?.toString()) || null });
  }

  async function handlePin(participant) {
    setChatMenu(null);
    try {
      const res = await togglePinChat(participant._id);
      updateConversationMeta(participant._id, { isPinned: !!res?.isPinned });
    } catch (e) { alert(e?.error || "Failed"); }
  }

  async function handleArchive(participant) {
    setChatMenu(null);
    try {
      const res = await toggleArchiveChat(participant._id);
      updateConversationMeta(participant._id, { isArchived: !!res?.isArchived });
      if (activeChat?._id?.toString() === participant._id && res?.isArchived) setActiveChat(null);
    } catch (e) { alert(e?.error || "Failed"); }
  }

  async function handleDelete(participant) {
    setChatMenu(null);
    if (!window.confirm(`Delete chat with ${participant.username || participant.displayName || "this user"}?`)) return;
    try { await deleteChat(participant._id); removeConversation(participant._id); }
    catch (e) { alert(e?.error || "Failed"); }
  }

  function getLastSeenText(chat) {
    if (chat._isAI) return "Ask anything";
    const id = chat._id?.toString();
    if (onlineUsers.has(id)) return "Online";
    const ls = lastSeen[id] || chat.lastSeen;
    if (!ls) return chat.username ? chat.username : "Tap to chat";
    return `last seen ${new Date(ls).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}`;
  }

  /* ── Render ── */
  return (
    <div
      className={`sb-root${isMobile ? " sb-root--mobile" : ""}`}
      style={{ width: isMobile ? "100%" : 330, flexShrink: 0 }}
    >
      {/* ── Inline Profile Editor (replaces header when open) ── */}
      {editOpen ? (
        <ProfileEditor user={user} onClose={() => setEditOpen(false)} />
      ) : (
        <>
          {/* ════ HEADER ════ */}
          <div className="sb-header">

            {/* Profile row */}
            <div className="sb-profile">
              <SbAvatar name={myName} emoji={user?.avatar || ""} size={52} online />
              <div className="sb-profile__info">
                <div className="sb-profile__name">{myName}</div>
                <div className="sb-profile__handle">
                  {user?.username ? user.username : "Encrypted · Online"}
                </div>
              </div>
              <button
                type="button" title="Edit profile"
                className="sb-profile__edit-btn"
                onClick={() => setEditOpen(true)}
              >
                <Icon size={15} stroke={2}>
                  <path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/>
                </Icon>
              </button>
            </div>

            {/* Stats row */}
            <div className="sb-stats">
              <div className="sb-stat">
                <span className="sb-stat__num">{visibleCount}</span>
                <span className="sb-stat__lbl">Live chats</span>
              </div>
              <div className="sb-stat">
                <span className="sb-stat__num" style={{ color: unreadChats > 0 ? "var(--sb-accent)" : undefined }}>
                  {unreadChats}
                </span>
                <span className="sb-stat__lbl">Unread</span>
              </div>
            </div>

            {/* Action icons row */}
            <div className="sb-actions">
              <ActionBtn title="Dark / Light" onClick={toggleTheme}>
                {theme === "dark" ? (
                  <Icon><path d="M12 3a6 6 0 0 0 9 9A9 9 0 1 1 12 3Z"/></Icon>
                ) : (
                  <Icon>
                    <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-14.07 1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2m-4.93-7.07-1.41 1.41M6.34 17.66l-1.41 1.41"/>
                  </Icon>
                )}
              </ActionBtn>

              <ActionBtn title="Security" active={securityPanel} onClick={() => setSecurityPanel(!securityPanel)}>
                <Icon><path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4Z"/><path d="M9.5 12.5 11 14l4-4"/></Icon>
              </ActionBtn>

              <ActionBtn title="Log out" danger onClick={() => setConfirmLogout(true)}>
                <Icon><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></Icon>
              </ActionBtn>
            </div>

            {/* Search bar */}
            <div className="sb-search">
              <span className="sb-search__icon">
                <Icon size={15}><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></Icon>
              </span>
              <input
                className="sb-search__input"
                placeholder="Search chats or start new chat…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button type="button" className="sb-search__clear" onClick={() => setSearch("")} aria-label="Clear">
                  <Icon size={13} stroke={2.5}><path d="M18 6 6 18M6 6l12 12"/></Icon>
                </button>
              )}
            </div>

            {/* Mode badge */}
            <div className="sb-mode-bar">
              <span className="sb-mode-chip">
                {normalizedSearch ? "Searching" : "Inbox"}
              </span>
              <span className="sb-mode-text">
                {normalizedSearch ? "Finding users and chats…" : "Your encrypted conversations"}
              </span>
            </div>
          </div>

          {/* ════ CHAT LIST ════ */}
          <div className="sb-list">
            {/* AI row */}
            {aiMatchesSearch && (
              <ChatRow
                chat={AI_CHAT} isActive={aiIsActive} unread={aiUnread}
                preview={aiLastMessage?.message || ""} timestamp={aiLastMessage?.createdAt || null}
                online subtitle="Ask anything" pinned={false}
                onClick={() => selectChat(AI_CHAT)} onContextMenu={undefined}
              />
            )}

            {/* Regular conversations */}
            {visibleConversations.map(conv => {
              const p = conv.participant;
              const id = p?._id?.toString();
              const unread = getUnread(id, messages, user);
              return (
                <ChatRow
                  key={id} chat={p}
                  isActive={activeChat?._id?.toString() === id}
                  unread={unread}
                  preview={conv?.lastMessage?.message || (conv?.lastMessage ? "Encrypted message" : "")}
                  timestamp={conv?.lastMessage?.createdAt || conv?.updatedAt || null}
                  online={onlineUsers.has(id)}
                  subtitle={getLastSeenText(p)}
                  pinned={!!conv.isPinned}
                  onClick={() => selectChat(p)}
                  onContextMenu={e => handleCtxMenu(e, p)}
                />
              );
            })}

            {/* Empty local state */}
            {visibleConversations.length === 0 && !aiMatchesSearch && !normalizedSearch && (
              <div className="sb-empty">
                No chats yet — search above to start one
              </div>
            )}

            {/* Global User Search */}
            {normalizedSearch.length >= 2 && (
              <>
                <div style={{ marginTop: 12, marginBottom: 6, padding: "0 10px", fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--sb-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Global Users
                </div>
                {loadingUsers && <div className="sb-empty">Searching network…</div>}
                {!loadingUsers && searchError && <div className="sb-empty sb-empty--danger">{searchError}</div>}
                {!loadingUsers && availableUsers.length === 0 && !searchError && (
                  <div className="sb-empty">No new users found</div>
                )}
                {!loadingUsers && availableUsers.map(chat => (
                  <ChatRow
                    key={chat._id} chat={chat}
                    isActive={activeChat?._id?.toString() === chat._id?.toString()}
                    unread={0} preview="" timestamp={null}
                    online={onlineUsers.has(chat._id?.toString())}
                    subtitle="Double-click to chat / Tap to select"
                    pinned={false} onClick={() => selectChat(chat)}
                  />
                ))}
              </>
            )}

            {/* Archived section */}
            {!normalizedSearch && archivedConversations.length > 0 && (
              <div className="sb-archived">
                <button type="button" className="sb-archived__toggle" onClick={() => setShowArch(p => !p)}>
                  <span>{showArchived ? "Hide archived" : `Archived (${archivedConversations.length})`}</span>
                  <Icon size={13}><path d={showArchived ? "m18 15-6-6-6 6" : "m6 9 6 6 6-6"}/></Icon>
                </button>
                {showArchived && archivedConversations.map(conv => {
                  const p = conv.participant;
                  const id = p?._id?.toString();
                  return (
                    <ChatRow
                      key={`arch_${id}`} chat={p}
                      isActive={activeChat?._id?.toString() === id}
                      unread={getUnread(id, messages, user)}
                      preview={conv?.lastMessage?.message || (conv?.lastMessage ? "Encrypted message" : "")}
                      timestamp={conv?.lastMessage?.createdAt || conv?.updatedAt || null}
                      online={onlineUsers.has(id)}
                      subtitle={getLastSeenText(p)}
                      pinned={!!conv.isPinned}
                      onClick={() => selectChat(p)}
                      onContextMenu={e => handleCtxMenu(e, p)}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* ════ FOOTER ════ */}
          <div className="sb-footer">
            <span className="sb-footer__status">
              <span className="sb-footer__dot" />
              End-to-end encrypted
            </span>
            <span className="sb-footer__badge">E2E</span>
          </div>
        </>
      )}

      {/* ── Context menu ── */}
      {chatMenu && (
        <div
          className="context-menu"
          style={{
            position: "fixed",
            top: Math.min(chatMenu.y, window.innerHeight - 160),
            left: Math.min(chatMenu.x, window.innerWidth - 210),
            zIndex: 1200, minWidth: 200,
          }}
          onClick={e => e.stopPropagation()}
        >
          <button type="button" className="ctx-menu-item" onClick={() => handlePin(chatMenu.participant)}>
            <Icon size={14}><path d="M9 3l6 6"/><path d="M15 3l6 6"/><path d="M7 11l6 6"/><path d="M3 21l6-6"/></Icon>
            {chatMenu.conversation?.isPinned ? "Unpin chat" : "Pin chat"}
          </button>
          <div className="ctx-menu-divider"/>
          <button type="button" className="ctx-menu-item" onClick={() => handleArchive(chatMenu.participant)}>
            <Icon size={14}><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></Icon>
            {chatMenu.conversation?.isArchived ? "Unarchive chat" : "Archive chat"}
          </button>
          <div className="ctx-menu-divider"/>
          <button type="button" className="ctx-menu-item ctx-menu-item--danger" onClick={() => handleDelete(chatMenu.participant)}>
            <Icon size={14}><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></Icon>
            Delete chat
          </button>
        </div>
      )}

      {/* ── Custom Confirm UI ── */}
      {confirmLogout && createPortal(
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
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: "var(--text-primary)" }}>Log Out</div>
            <div style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 24 }}>Are you sure you want to log out and end your secure session?</div>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                type="button"
                onClick={() => setConfirmLogout(false)}
                style={{
                  flex: 1, padding: "10px 0", borderRadius: 8, background: "var(--bg-3)",
                  color: "var(--text-primary)", border: "1px solid var(--border)", fontWeight: 600,
                  cursor: "pointer", transition: "background 0.2s"
                }}
              >Stay</button>
              <button
                type="button"
                onClick={() => { setConfirmLogout(false); logout(); }}
                style={{
                  flex: 1, padding: "10px 0", borderRadius: 8,
                  background: "var(--danger)", color: "#fff",
                  border: "none", fontWeight: 600, cursor: "pointer", transition: "opacity 0.2s"
                }}
              >Log Out</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

/* ─── Utility ─────────────────────────────────────────────────── */
function getUnread(userId, messages, user) {
  const id = userId?.toString();
  const chatMsgs = messages[id] || [];
  return chatMsgs.filter(
    m => m.sender?.toString() !== user?._id?.toString() && m.status !== "read"
  ).length;
}
