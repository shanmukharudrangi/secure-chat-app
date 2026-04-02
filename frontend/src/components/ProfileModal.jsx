import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { getUserProfile, updateProfile } from "../services/userService";

const AVATAR_OPTIONS = [
  "\u{1F464}", "\u{1F60A}", "\u{1F98A}", "\u{1F43B}",
  "\u{1F43C}", "\u{1F981}", "\u{1F42F}", "\u{1F98B}",
  "\u{1F338}", "\u{26A1}", "\u{1F525}", "\u{1F30A}",
];

function ModalAvatar({ profile, size = 72 }) {
  const name = profile?.displayName || profile?.username || profile?.email || "?";
  const emoji = profile?.avatar || "";
  const hue = name.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  const isEmoji = /\p{Emoji}/u.test(emoji) && emoji.length <= 2;

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: isEmoji ? "var(--bg-3)" : `hsl(${hue}, 50%, 34%)`,
        border: `2px solid ${isEmoji ? "var(--accent)" : `hsl(${hue}, 50%, 26%)`}`,
        fontSize: isEmoji ? size * 0.46 : size * 0.34,
        fontWeight: 700,
        color: isEmoji ? "unset" : `hsl(${hue}, 80%, 88%)`,
        fontFamily: isEmoji
          ? "Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji, sans-serif"
          : "var(--font-sans)",
        boxShadow: isEmoji ? "0 0 20px rgba(74,215,176,0.16)" : "none",
        flexShrink: 0,
      }}
    >
      {emoji || name.slice(0, 1).toUpperCase()}
    </div>
  );
}

export default function ProfileModal({ userId, editable = false, onClose }) {
  const { user, updateUser } = useAuth();
  const [profile, setProfile] = useState(editable ? user : null);
  const [form, setForm] = useState({
    displayName: editable ? user?.displayName || "" : "",
    username: editable ? user?.username || "" : "",
    bio: editable ? user?.bio || "" : "",
    avatar: editable ? user?.avatar || AVATAR_OPTIONS[0] : AVATAR_OPTIONS[0],
  });
  const [loading, setLoading] = useState(!editable);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (editable) {
      setProfile(user);
      setForm({
        displayName: user?.displayName || "",
        username: user?.username || "",
        bio: user?.bio || "",
        avatar: user?.avatar || AVATAR_OPTIONS[0],
      });
      setLoading(false);
      return;
    }

    if (!userId) return;

    let cancelled = false;
    setLoading(true);
    setError("");

    getUserProfile(userId)
      .then((data) => {
        if (!cancelled) setProfile(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.error || "Failed to load profile");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [editable, user, userId]);

  function updateField(field, value) {
    setForm((curr) => ({ ...curr, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const displayName = form.displayName.trim();
    const username = form.username.trim().toLowerCase();
    const bio = form.bio.trim();

    if (!displayName) return setError("Display name is required");
    if (!/^[a-z0-9_]{3,30}$/.test(username)) {
      return setError("Username must be 3-30 characters using letters, numbers, or underscores");
    }
    if (bio.length > 200) return setError("Bio must be 200 characters or fewer");

    setSaving(true);
    setError("");

    try {
      const updated = await updateProfile({ displayName, username, avatar: form.avatar, bio });
      updateUser(updated);
      onClose?.();
    } catch (err) {
      setError(err?.error || "Failed to update profile");
    } finally {
      setSaving(false);
    }
  }

  const readOnlyProfile = profile || user;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "rgba(6, 10, 18, 0.68)",
        backdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--panel-elevated)",
          border: "1px solid var(--border-strong)",
          borderRadius: 26,
          width: "min(92vw, 520px)",
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "var(--shadow)",
          backdropFilter: "blur(18px)",
          animation: "floatIn 0.28s ease",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Accent gradient bar at top */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: "linear-gradient(90deg, var(--accent), var(--info))",
          }}
        />

        {/* Header */}
        <div
          style={{
            padding: "22px 22px 18px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          {!loading && !error && (
            <div style={{ flexShrink: 0 }}>
              <ModalAvatar profile={editable ? form : readOnlyProfile} size={52} />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700 }}>
              {editable ? "Edit profile" : "Profile"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
              {editable
                ? "Update how people find and see you"
                : (readOnlyProfile?.username ? `@${readOnlyProfile.username}` : "View contact details")}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              cursor: "pointer",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {loading ? (
          <div style={{ padding: 40, color: "var(--text-secondary)", textAlign: "center" }}>
            <div style={{ fontSize: 13, fontFamily: "var(--font-mono)" }}>Loading profile...</div>
          </div>
        ) : error && !editable ? (
          <div style={{ padding: 28, color: "var(--danger)", textAlign: "center", fontSize: 13 }}>
            {error}
          </div>
        ) : editable ? (
          /* ── Edit form ── */
          <form onSubmit={handleSubmit} style={{ padding: "22px 22px 24px", display: "grid", gap: 18 }}>
            {error && (
              <div
                style={{
                  background: "var(--danger-dim)",
                  border: "1px solid rgba(216,58,92,0.25)",
                  borderRadius: 12,
                  padding: "11px 14px",
                  color: "var(--danger)",
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {error}
              </div>
            )}

            {/* Avatar picker */}
            <div>
              <div className="form-label" style={{ marginBottom: 14 }}>Avatar</div>
              <div className="avatar-picker-grid">
                {AVATAR_OPTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => updateField("avatar", emoji)}
                    className={`avatar-option${form.avatar === emoji ? " avatar-option--active" : ""}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            {/* Display name */}
            <div className="form-field">
              <label className="form-label">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
                Display Name
              </label>
              <input
                className="form-input"
                value={form.displayName}
                maxLength={50}
                placeholder="Your name"
                onChange={(e) => updateField("displayName", e.target.value)}
              />
              <div className="form-hint">
                <span>Shown across chats and messages</span>
                <span>{form.displayName.length} / 50</span>
              </div>
            </div>

            {/* Username */}
            <div className="form-field">
              <label className="form-label">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="4"/>
                  <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/>
                </svg>
                Username
              </label>
              <input
                className="form-input"
                value={form.username}
                maxLength={30}
                placeholder="your_username"
                onChange={(e) =>
                  updateField("username", e.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())
                }
              />
              <div className="form-hint">
                <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
                  @{form.username || "username"}
                </span>
                <span>{form.username.length} / 30</span>
              </div>
            </div>

            {/* Bio */}
            <div className="form-field">
              <label className="form-label">Bio <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-sans)", textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>(optional)</span></label>
              <textarea
                className="form-textarea"
                rows={3}
                value={form.bio}
                maxLength={200}
                placeholder="Say something about yourself…"
                onChange={(e) => updateField("bio", e.target.value)}
              />
              <div className={`form-hint${form.bio.length > 160 ? " form-hint--warn" : ""}`}>
                <span>Short intro</span>
                <span>{form.bio.length} / 200</span>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ color: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
                Find me at @{form.username || "username"}
              </div>
              <button
                type="submit"
                disabled={saving}
                style={{
                  minWidth: 120,
                  padding: "11px 20px",
                  borderRadius: 14,
                  background: saving
                    ? "var(--bg-4)"
                    : "linear-gradient(135deg, var(--accent), var(--info))",
                  color: saving ? "var(--text-muted)" : "#03140b",
                  fontWeight: 700,
                  fontSize: 14,
                  border: "none",
                  cursor: saving ? "default" : "pointer",
                  boxShadow: saving ? "none" : "0 12px 24px rgba(74,215,176,0.18)",
                  transition: "all 0.2s ease",
                }}
              >
                {saving ? "Saving..." : "Save changes"}
              </button>
            </div>
          </form>
        ) : (
          /* ── Read-only view ── */
          <div style={{ padding: "22px 22px 24px", display: "grid", gap: 18 }}>
            {/* Avatar + name hero */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <ModalAvatar profile={readOnlyProfile} size={80} />
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>
                  {readOnlyProfile?.displayName || "Unknown user"}
                </div>
                <div style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 2, fontFamily: "var(--font-mono)" }}>
                  {readOnlyProfile?.username ? `@${readOnlyProfile.username}` : readOnlyProfile?.email}
                </div>
              </div>

              {/* Status badge */}
              <span className={`status-chip ${readOnlyProfile?.isOnline ? "status-chip--accent" : ""}`}
                style={{ fontSize: 10 }}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: readOnlyProfile?.isOnline ? "var(--accent)" : "var(--text-muted)",
                  display: "inline-block",
                }} />
                {readOnlyProfile?.isOnline ? "Online" : "Offline"}
              </span>
            </div>

            {/* Details card */}
            <div
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid var(--border)",
                borderRadius: 18,
                padding: "18px 18px",
                display: "grid",
                gap: 16,
              }}
            >
              {readOnlyProfile?.bio && (
                <div>
                  <div className="form-label" style={{ marginBottom: 6 }}>Bio</div>
                  <div style={{ fontSize: 14, color: "var(--text-primary)", lineHeight: 1.6 }}>
                    {readOnlyProfile.bio}
                  </div>
                </div>
              )}
              <div>
                <div className="form-label" style={{ marginBottom: 6 }}>Email</div>
                <div style={{ fontSize: 14, fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                  {readOnlyProfile?.email || "Hidden"}
                </div>
              </div>
              {readOnlyProfile?.createdAt && (
                <div>
                  <div className="form-label" style={{ marginBottom: 6 }}>Joined</div>
                  <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
                    {new Date(readOnlyProfile.createdAt).toLocaleDateString([], {
                      year: "numeric", month: "long", day: "numeric",
                    })}
                  </div>
                </div>
              )}
              {readOnlyProfile?.lastSeen && !readOnlyProfile?.isOnline && (
                <div>
                  <div className="form-label" style={{ marginBottom: 6 }}>Last seen</div>
                  <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>
                    {new Date(readOnlyProfile.lastSeen).toLocaleString()}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
