import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { sendOTP, verifyOTP } from "../services/authService";
import {
  generateRSAKeyPair,
  generateSigningKeyPair,
  exportPublicKeyPem,
  exportPrivateKeyPem,
} from "../crypto/keyUtils";
import { getLegacyKeyPair, getStoredKeyPair } from "../services/keyStorage";

export default function AuthPage() {
  const [step, setStep] = useState("input");
  const [identifier, setIdentifier] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const { login } = useAuth();
  const fullIdentifier = identifier.trim().toLowerCase();

  async function handleSendOTP(e) {
    e.preventDefault();
    setError("");
    if (!fullIdentifier.includes("@"))
      return setError("Please enter a valid email address");
    setLoading(true);
    try {
      const res = await sendOTP(fullIdentifier);
      if (res.message) { setStep("otp"); setInfo(`OTP sent to ${fullIdentifier}`); }
      else setError(res.error || "Failed to send OTP");
    } catch {
      setError("Network error — make sure the backend is running on port 5000");
    }
    setLoading(false);
  }

  async function handleVerifyOTP(e) {
    e.preventDefault();
    const otpCode = otp.join("");
    if (otpCode.length < 6) return setError("Enter all 6 digits");
    setLoading(true);
    setError("");
    try {
      const storedKeys = getStoredKeyPair(fullIdentifier);
      const legacyKeys = !storedKeys.privateKeyPem
        ? getLegacyKeyPair()
        : { privateKeyPem: null, publicKeyPem: null };
      let pubPem = storedKeys.publicKeyPem || legacyKeys.publicKeyPem || null;
      let privPem = storedKeys.privateKeyPem || legacyKeys.privateKeyPem || null;
      let signingPrivPem = storedKeys.signingKeyPem || null;
      let signingPubPem = null;

      if (!privPem || !signingPrivPem) {
        // Generate encryption keys if missing
        if (!privPem) {
          const keyPair = await generateRSAKeyPair();
          pubPem = await exportPublicKeyPem(keyPair.publicKey);
          privPem = await exportPrivateKeyPem(keyPair.privateKey);
        }
        // Generate signing keys if missing
        if (!signingPrivPem) {
          const signingKeyPair = await generateSigningKeyPair();
          signingPubPem = await exportPublicKeyPem(signingKeyPair.publicKey);
          signingPrivPem = await exportPrivateKeyPem(signingKeyPair.privateKey);
        }
      }

      const res = await verifyOTP(fullIdentifier, otpCode, pubPem, signingPubPem);
      if (res.token) {
        await login(res.user, res.token, privPem, pubPem, signingPrivPem, signingPubPem || res.user.signingPublicKey);
      } else setError(res.error || "Invalid OTP");
    } catch (err) {
      console.error("[AuthPage] verifyOTP error:", err);
      setError("Verification failed. Please try again.");
    }
    setLoading(false);
  }

  function handleOtpChange(i, val) {
    if (!/^\d*$/.test(val)) return;
    const updated = [...otp];
    updated[i] = val.slice(-1);
    setOtp(updated);
    if (val && i < 5) document.getElementById(`otp-${i + 1}`)?.focus();
  }

  function handleOtpKeyDown(i, e) {
    if (e.key === "Backspace" && !otp[i] && i > 0) document.getElementById(`otp-${i - 1}`)?.focus();
    if (e.key === "ArrowLeft" && i > 0) document.getElementById(`otp-${i - 1}`)?.focus();
    if (e.key === "ArrowRight" && i < 5) document.getElementById(`otp-${i + 1}`)?.focus();
  }

  function handleOtpPaste(e) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length) {
      const digits = text.split("");
      const updated = [...otp];
      digits.forEach((d, i) => { if (i < 6) updated[i] = d; });
      setOtp(updated);
      document.getElementById(`otp-${Math.min(digits.length, 5)}`)?.focus();
      e.preventDefault();
    }
  }

  return (
    <div className="auth-shell">

      {/* Ambient blobs moved to shell level to span entire width */}
      <div className="auth-blob auth-blob--1" />
      <div className="auth-blob auth-blob--2" />

      <div className="auth-container">
        {/* ══════════════ LEFT — scrollable content ══════════════ */}
        <div className="auth-left">

          <div className="auth-left__inner">

          {/* Brand mark */}
          <div className="auth-brand">
            <div className="auth-brand__logo">SC</div>
            <div>
              <div className="auth-brand__name">SecureChat</div>
              <div className="auth-brand__tag">End-to-end encrypted</div>
            </div>
          </div>

          {/* Hero */}
          <div className="auth-hero">
            <div className="auth-hero__eyebrow">
              <span className="auth-hero__dot" />
              Private Messaging Stack
            </div>
            <h1 className="auth-hero__title">
              Calm, premium<br />messaging with keys<br />
              <span className="auth-hero__accent">that stay on your device.</span>
            </h1>
            <p className="auth-hero__sub">
              SecureChat signs you in with OTP, keeps your private encryption
              key in the browser, and gives every conversation a focused,
              command-center feel.
            </p>
          </div>

          {/* Feature cards */}
          <div className="auth-features">
            {[
              { n: "01", title: "Local-first key ownership", desc: "Your private RSA key never leaves the browser session that generated it." },
              { n: "02", title: "Secure identity flow",      desc: "OTP sign-in pairs naturally with device-held encryption — no passwords." },
              { n: "03", title: "Realtime encrypted chat",   desc: "AES-256 message payloads with RSA-OAEP key exchange on every session." },
              { n: "04", title: "Built for privacy",        desc: "No tracking, no ads, no cloud keys. Your conversations are yours alone." },
            ].map(f => (
              <div key={f.n} className="auth-feature-card">
                <div className="auth-feature-card__num">{f.n}</div>
                <div>
                  <div className="auth-feature-card__title">{f.title}</div>
                  <div className="auth-feature-card__desc">{f.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Stats bar */}
          <div className="auth-stats">
            {[
              { val: "AES-256",  lbl: "Message encryption" },
              { val: "RSA-OAEP", lbl: "Key exchange" },
              { val: "OTP",      lbl: "Passwordless sign-in" },
              { val: "0",        lbl: "Keys stored server-side" },
            ].map(s => (
              <div key={s.val} className="auth-stat">
                <div className="auth-stat__val">{s.val}</div>
                <div className="auth-stat__lbl">{s.lbl}</div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="auth-left__footer">
            <span className="auth-footer__dot" />
            All communications are end-to-end encrypted · SecureChat © 2025
          </div>
        </div>
      </div>

      {/* ══════════════ RIGHT — sticky sign-in panel ══════════════ */}
      <div className="auth-right">
        <div className="auth-card">

          {/* Card logo */}
          <div className="auth-card__logo">
            <div className="auth-card__logo-icon">SC</div>
            <div>
              <div className="auth-card__logo-name">SecureChat</div>
              <div className="auth-card__logo-sub">Entry Console</div>
            </div>
          </div>

          {step === "input" ? (
            <form onSubmit={handleSendOTP} className="auth-form">
              <div className="auth-form__heading">Sign in</div>
              <div className="auth-form__sub">
                Enter your email and we'll send a one-time password to start a
                secure session.
              </div>

              {error && <ErrorBanner message={error} />}

              <div className="form-field">
                <label className="form-label">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect width="20" height="16" x="2" y="4" rx="2"/>
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                  </svg>
                  Email Address
                </label>
                <input
                  className="form-input"
                  type="email"
                  placeholder="you@example.com"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  autoFocus
                />
              </div>

              <button type="submit" disabled={loading} className="btn-primary">
                {loading ? "Sending OTP…" : "Send OTP →"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOTP} className="auth-form">
              <div className="auth-form__heading">Enter OTP</div>
              <div className="auth-form__sub">
                Code sent to{" "}
                <strong style={{ color: "var(--text-primary)" }}>{fullIdentifier}</strong>
              </div>

              {error && <ErrorBanner message={error} />}
              {info && (
                <div className="auth-info-banner">✓ {info}</div>
              )}

              <div className="form-label" style={{ marginBottom: 12 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                One-Time Password
              </div>

              <div className="otp-grid" style={{ marginBottom: 26 }} onPaste={handleOtpPaste}>
                {otp.map((d, i) => (
                  <input
                    key={i}
                    id={`otp-${i}`}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={d}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    autoFocus={i === 0}
                    className={`otp-digit${d ? " otp-digit--filled" : ""}`}
                  />
                ))}
              </div>

              <button type="submit" disabled={loading} className="btn-primary">
                {loading ? "Verifying…" : "Verify & Continue →"}
              </button>

              <div style={{ textAlign: "center", marginTop: 16 }}>
                <button
                  type="button"
                  onClick={() => { setStep("input"); setOtp(["","","","","",""]); setError(""); setInfo(""); }}
                  className="btn-ghost"
                >
                  ← Change email
                </button>
              </div>
            </form>
          )}

          {/* Security badge */}
          <div className="auth-card__badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4Z"/>
            </svg>
            End-to-end encrypted session
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}

function ErrorBanner({ message }) {
  return (
    <div className="auth-error-banner">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      {message}
    </div>
  );
}
