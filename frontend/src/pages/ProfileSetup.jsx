import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { createProfile } from "../services/userService";

const AVATAR_OPTIONS = [
  "\u{1F464}", "\u{1F60A}", "\u{1F98A}", "\u{1F43B}",
  "\u{1F43C}", "\u{1F981}", "\u{1F42F}", "\u{1F98B}",
  "\u{1F338}", "\u{26A1}", "\u{1F525}", "\u{1F30A}",
];

export default function ProfileSetup() {
  const { user, updateUser, completeProfile } = useAuth();
  const [name, setName] = useState(user?.displayName || "");
  const [username, setUsername] = useState(user?.username || "");
  const [bio, setBio] = useState("");
  const [avatar, setAvatar] = useState("\u{1F464}");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const nameWarn = name.length > 40;
  const bioWarn = bio.length > 160;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) return setError("Please enter your name");
    if (!username.trim()) return setError("Please enter a username");
    if (name.trim().length > 50) return setError("Name must be 50 characters or fewer");
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username.trim())) {
      return setError("Username must be 3-30 characters using letters, numbers, or underscores");
    }
    if (bio.length > 200) return setError("Bio must be 200 characters or fewer");

    setLoading(true);
    setError("");

    try {
      const res = await createProfile({
        name: name.trim(),
        username: username.trim(),
        avatar,
        bio: bio.trim(),
        publicKey: user?.publicKey || localStorage.getItem(`sc_pub_pem:${user?.email?.toLowerCase()}`),
        signingPublicKey: localStorage.getItem(`sc_spub_pem:${user?.email?.toLowerCase()}`) || undefined
      });

      if (res.profile) {
        updateUser({
          ...user,
          username: res.user.username,
          displayName: res.user.displayName,
          avatar: res.user.avatar,
          bio: res.user.bio,
          isProfileCompleted: true,
        });
        completeProfile();
      } else {
        setError(res.error || "Failed to save profile. Please try again.");
      }
    } catch {
      setError("Network error - please check your connection and try again.");
    }

    setLoading(false);
  }

  return (
    <div className="setup-shell">
      {/* Background grid overlay */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
          backgroundImage: `linear-gradient(rgba(74,215,176,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(74,215,176,0.03) 1px, transparent 1px)`,
          backgroundSize: "48px 48px",
        }}
      />

      <div className="setup-grid">
        {/* ── Left panel ── */}
        <aside className="setup-intro">
          <div style={{ position: "relative", zIndex: 1 }}>
            <div className="hero-eyebrow">Profile setup</div>
            <div style={{ marginTop: 22 }}>
              <div className="hero-title" style={{ fontSize: "clamp(28px,4vw,42px)" }}>
                Make it yours.
              </div>
              <div className="hero-copy">
                Choose how others see you on SecureChat — your avatar, name, and handle are the only identity they'll know.
              </div>
            </div>

            <div className="setup-step-list">
              <div className="setup-step setup-step--active">
                <div className="setup-step__mark">01</div>
                <div>
                  <strong>Choose your avatar</strong>
                  <span>Pick an emoji that represents you</span>
                </div>
              </div>
              <div className="setup-step">
                <div className="setup-step__mark">02</div>
                <div>
                  <strong>Set your identity</strong>
                  <span>Your display name and @username</span>
                </div>
              </div>
              <div className="setup-step">
                <div className="setup-step__mark">03</div>
                <div>
                  <strong>Add a short bio</strong>
                  <span>Optional — introduce yourself</span>
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              position: "relative",
              zIndex: 1,
              padding: "16px",
              borderRadius: 18,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.07)",
              fontSize: 12,
              color: "var(--text-secondary)",
              fontFamily: "var(--font-mono)",
            }}
          >
            🔒 Your profile is tied to your email address. It is visible only to users you chat with.
          </div>
        </aside>

        {/* ── Right panel / form ── */}
        <div className="setup-card">
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 32 }}>
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 14,
                background: "linear-gradient(135deg, rgba(74,215,176,0.92), rgba(138,180,255,0.92))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 16px 28px rgba(74,215,176,0.2)",
                color: "#04231d",
                fontSize: 17,
                fontWeight: 800,
                fontFamily: "var(--font-mono)",
              }}
            >
              SC
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.03em" }}>
                Set up your profile
              </div>
              <div className="surface-kicker" style={{ marginTop: 3 }}>
                This is how others will see and find you
              </div>
            </div>
          </div>

          {/* Avatar picker */}
          <div style={{ marginBottom: 28 }}>
            <div className="form-label" style={{ marginBottom: 14 }}>Choose avatar</div>

            <div className="avatar-picker-preview">
              <div className="avatar-picker-preview__circle">
                {avatar}
              </div>
            </div>

            <div className="avatar-picker-grid">
              {AVATAR_OPTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setAvatar(emoji)}
                  className={`avatar-option${avatar === emoji ? " avatar-option--active" : ""}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            {error && (
              <div
                style={{
                  background: "var(--danger-dim)",
                  border: "1px solid rgba(255,68,102,0.3)",
                  borderRadius: 12,
                  padding: "11px 14px",
                  fontSize: 13,
                  color: "#ff7799",
                  marginBottom: 20,
                }}
              >
                {error}
              </div>
            )}

            {/* Name */}
            <div className="form-field" style={{ marginBottom: 18 }}>
              <label className="form-label">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
                Your Name *
              </label>
              <input
                className="form-input"
                type="text"
                placeholder="Enter your display name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={50}
                autoFocus
              />
              <div className={`form-hint${nameWarn ? " form-hint--warn" : ""}`}>
                <span>Shown to other users</span>
                <span>{name.length} / 50</span>
              </div>
            </div>

            {/* Username */}
            <div className="form-field" style={{ marginBottom: 18 }}>
              <label className="form-label">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="4"/>
                  <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/>
                </svg>
                Username *
              </label>
              <input
                className="form-input"
                type="text"
                placeholder="your_username"
                value={username}
                onChange={(e) =>
                  setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))
                }
                maxLength={30}
              />
              <div className="form-hint">
                <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
                  {username || "username"}
                </span>
                <span>{username.length} / 30</span>
              </div>
            </div>

            {/* Bio */}
            <div className="form-field" style={{ marginBottom: 18 }}>
              <label className="form-label">
                Bio
                <span
                  style={{
                    fontFamily: "var(--font-sans)",
                    textTransform: "none",
                    letterSpacing: 0,
                    fontSize: 11,
                    color: "var(--text-muted)",
                    fontWeight: 400,
                  }}
                >
                  (optional)
                </span>
              </label>
              <textarea
                className="form-textarea"
                placeholder="Hey there! I'm using SecureChat."
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={200}
                rows={2}
              />
              <div className={`form-hint${bioWarn ? " form-hint--warn" : ""}`}>
                <span>Short intro about yourself</span>
                <span>{bio.length} / 200</span>
              </div>
            </div>

            {/* Account (read-only) */}
            <div className="form-field" style={{ marginBottom: 26 }}>
              <label className="form-label">Account</label>
              <div
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid var(--border)",
                  borderRadius: 16,
                  padding: "13px 16px",
                  fontSize: 14,
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {user?.email}
              </div>
            </div>

            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? "Saving profile..." : "Start Chatting →"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
