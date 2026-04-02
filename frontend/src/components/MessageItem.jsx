import { useState } from "react";

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * Horizontal integrity score bar with colour-coded status label.
 */
function IntegrityBar({ score, status }) {
  const { color, label } = getIntegrityStyle(status);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>
      {/* Progress bar */}
      <div style={{
        width: 48, height: 3,
        background: "var(--border-strong)",
        borderRadius: 2, overflow: "hidden",
      }}>
        <div style={{
          height: "100%",
          width: `${score ?? 0}%`,
          background: color,
          borderRadius: 2,
          transition: "width 0.6s ease",
        }} />
      </div>

      {/* Status badge */}
      <span style={{
        fontSize: 8, fontFamily: "var(--font-mono)",
        color, background: `${color}18`,
        padding: "1px 5px", borderRadius: 3, letterSpacing: 0.5,
      }}>
        {label}
      </span>

      {/* Numeric score */}
      <span style={{
        fontSize: 8, fontFamily: "var(--font-mono)", color: "#555",
      }}>
        {score ?? "—"}/100
      </span>
    </div>
  );
}

/**
 * WhatsApp-style delivery tick rendered with SVG paths so the
 * three states are always clearly distinct at any font size.
 *
 * ─ Single grey check   → "sent"      (saved to server)
 * ─ Double grey check   → "delivered" (arrived on receiver's device)
 * ─ Double green check  → "read"      (receiver opened the chat)
 */
function Tick({ status }) {
  if (!status || status === "pending") return null;

  const isRead      = status === "read";
  const isDelivered = status === "delivered" || isRead;
  const color       = isRead ? "var(--info)" : "var(--text-muted)";

  // Single tick SVG path
  const singlePath = "M4.5 12.5 L9 17 L19.5 7";

  // Double tick: first check shifted left, second overlapping right
  return (
    <svg
      width="18"
      height="12"
      viewBox="0 0 18 12"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, transition: "stroke 0.3s ease" }}
      aria-label={status}
    >
      {isDelivered ? (
        <>
          {/* First (left) check — slightly offset left */}
          <path d="M1 6.5 L5 10.5 L13 2.5" />
          {/* Second (right) check — overlaps */}
          <path d="M5 6.5 L9 10.5 L17 2.5" />
        </>
      ) : (
        /* Single check centered */
        <path d="M3 6.5 L7 10.5 L15 2.5" />
      )}
    </svg>
  );
}

/**
 * Integrity check row used in the expanded details panel.
 */
function Check({ ok, label, points }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{
        width: 14, height: 14, borderRadius: "50%",
        background: ok ? "rgba(132,154,101,0.2)" : "rgba(224,106,106,0.2)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 8,
        color: ok ? "var(--accent)" : "var(--danger)",
      }}>
        {ok ? "✓" : "✗"}
      </span>
      <span style={{ color: ok ? "var(--text-secondary)" : "var(--danger)" }}>
        {label}
      </span>
      <span style={{
        marginLeft: "auto",
        color: ok ? "var(--accent)" : "var(--text-muted)",
      }}>
        {points}
      </span>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns { color, label, icon } for a given integrityStatus string.
 * Single source of truth — used by both IntegrityBar and the bubble border.
 */
function getIntegrityStyle(status) {
  switch (status) {
    case "secure":
      return { color: "#849a65", label: "✓ SECURE",   icon: "🔒" };
    case "warning":
      return { color: "#dca556", label: "⚠ WARNING",  icon: "⚠️" };
    case "tampered":
      return { color: "#e06a6a", label: "✗ TAMPERED", icon: "🚨" };
    case "ai":
      return { color: "#7f77dd", label: "AI",          icon: "🤖" };
    default:
      // Message is mid-decryption or integrity not yet computed
      return { color: "#8c8678", label: "PENDING",     icon: "🔐" };
  }
}

/**
 * Truncate a long hex string for display, showing first and last N chars.
 */
function truncateHex(hex, keep = 16) {
  if (!hex || hex.length <= keep * 2 + 3) return hex;
  return `${hex.slice(0, keep)}…${hex.slice(-keep)}`;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MessageItem({ msg, isMine, onContextMenu }) {
  const [expanded, setExpanded] = useState(false);

  const status        = msg.integrityStatus;
  const isTampered    = status === "tampered";
  const isWarning     = status === "warning";
  const isAI          = status === "ai";

  // Use the explicit flag set by ChatWindow — not string matching on message text
  const isPending     = msg._needsDecrypt && !msg._decrypted;
  const isDecryptFail = msg._decryptFailed === true;

  const { color: integrityColor, icon: integrityIcon } = getIntegrityStyle(status);

  // ── Bubble styles ──────────────────────────────────────────────────────────
  const bubbleBg = isTampered    ? "var(--danger-dim)"
    : isWarning                  ? "rgba(220,165,86,0.06)"
    : isAI                       ? "rgba(127,119,221,0.08)"
    : isMine                     ? "var(--sent-bg)"
    : "var(--recv-bg)";

  const bubbleBorder = isTampered ? "1px solid rgba(224,106,106,0.4)"
    : isWarning                   ? "1px solid rgba(220,165,86,0.25)"
    : isAI                        ? "1px solid rgba(127,119,221,0.3)"
    : isMine                      ? "1px solid var(--border-active)"
    : "1px solid var(--border)";

  const borderRadius = isMine
    ? "12px 12px 4px 12px"
    : "12px 12px 12px 4px";

  const ts = msg.createdAt
    ? new Date(msg.createdAt).toLocaleTimeString([], {
        hour: "2-digit", minute: "2-digit",
      })
    : "";
  const fullTimestamp = msg.createdAt ? new Date(msg.createdAt).toLocaleString() : undefined;
  const replyPreview = msg.replyTo?.preview || "";
  const isStarred = msg.starred === true;

  // ── Render message text based on state ────────────────────────────────────
  function renderMessageText() {
    // Still waiting for decryption
    if (isPending) {
      return (
        <span style={{
          color: "var(--text-muted)", fontStyle: "italic",
          fontFamily: "var(--font-mono)", fontSize: 12,
        }}>
          🔓 Decrypting…
        </span>
      );
    }

    // Decryption explicitly failed (flag set by ChatWindow)
    if (isDecryptFail) {
      return (
        <span style={{ color: "var(--warn)" }}>
          ⚠ Decryption failed
        </span>
      );
    }

    // Normal plaintext
    return (
      <span style={{
        color: isTampered    ? "var(--danger)"
          : isAI             ? "var(--text-primary)"
          : "var(--text-primary)",
      }}>
        {msg.message ?? ""}
      </span>
    );
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: isMine ? "flex-end" : "flex-start",
      marginBottom: 8,
    }}>

      {/* ── Tamper alert banner ── */}
      {isTampered && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "var(--danger-dim)",
          border: "1px solid rgba(224,106,106,0.4)",
          borderRadius: 8, padding: "5px 12px", marginBottom: 4,
          fontSize: 11, color: "var(--danger)",
          fontFamily: "var(--font-mono)",
        }}>
          🚨 TAMPER DETECTED — Hash mismatch. This message may have been altered.
        </div>
      )}

      {/* ── Message bubble ── */}
      <div
        onMouseDown={(e) => {
          if (!onContextMenu || isPending || e.button !== 2) return;
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e, msg);
        }}
        onContextMenu={(e) => {
          if (!onContextMenu || isPending) return;
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e, msg);
        }}
        onClick={() => !isPending && setExpanded((v) => !v)}
        title={isPending ? undefined : "Click to see security details"}
        style={{
          maxWidth: "72%",
          background: bubbleBg,
          border: bubbleBorder,
          borderRadius,
          padding: "9px 13px",
          cursor: isPending ? "default" : "pointer",
          transition: "opacity 0.15s",
        }}
      >
        {replyPreview && (
          <div
            style={{
              marginBottom: 8,
              padding: "7px 9px",
              borderRadius: 10,
              background: isMine ? "var(--border)" : "var(--border-strong)",
              borderLeft: "3px solid var(--accent)",
            }}
            title={fullTimestamp}
          >
            <div
              style={{
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                color: "var(--accent)",
                marginBottom: 2,
              }}
            >
              {msg.replyTo?.sender?.toString() === msg.sender?.toString() ? "Replying to self" : "Reply"}
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-secondary)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {replyPreview}
            </div>
          </div>
        )}

        {/* Message text */}
        <div style={{
          fontSize: 14, lineHeight: 1.55, wordBreak: "break-word",
          whiteSpace: "pre-line",
        }}>
          {renderMessageText()}
        </div>

        {/* ── Timestamp + tick + integrity icon ── */}
        <div style={{
          display: "flex", alignItems: "center",
          gap: 5, marginTop: 4,
        }}>
          {isStarred && (
            <span style={{ fontSize: 11, color: "var(--warn)" }} title="Starred">
              ★
            </span>
          )}
          <span style={{
            fontSize: 10, color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
          }} title={fullTimestamp}>
            {ts}
          </span>

          {/* Delivery tick — only shown on sender's own messages */}
          {isMine && <Tick status={msg.status} />}

          {/* Integrity icon — right-aligned */}
          {!isPending && (
            <span style={{ marginLeft: "auto", fontSize: 11 }}>
              {integrityIcon}
            </span>
          )}

        </div>

        {/* ── Integrity score bar ── */}
        {!isPending &&
          msg.integrityScore !== undefined &&
          msg.integrityScore !== null && (
            <IntegrityBar
              score={msg.integrityScore}
              status={status}
            />
          )}

        {/* ── Expanded security details panel ── */}
        {expanded && !isPending && (
          <div style={{
            marginTop: 10, paddingTop: 10,
            borderTop: "1px solid var(--border)",
            fontSize: 10, fontFamily: "var(--font-mono)",
            color: "var(--text-muted)",
            display: "flex", flexDirection: "column", gap: 3,
          }}>
            <div style={{
              fontWeight: 700, color: "var(--text-secondary)",
              marginBottom: 4, letterSpacing: 1,
            }}>
              INTEGRITY VERIFICATION
            </div>

            <Check
              ok={msg.signatureValid}
              label="Digital Signature"
              points="+40"
            />
            <Check
              ok={msg.fingerprintValid}
              label="SHA-256 Fingerprint"
              points="+30"
            />
            <Check
              ok={msg.authTagValid}
              label="AES-GCM Auth Tag"
              points="+30"
            />

            {/* Fingerprint display — truncated to prevent layout overflow */}
            {msg.fingerprint && (
              <div style={{
                marginTop: 6, lineHeight: 1.6,
              }}>
                <span style={{ color: "var(--info)" }}>SHA256:</span>
                <br />
                <span
                  title={msg.fingerprint}
                  style={{
                    color: "var(--text-muted)", fontSize: 9,
                    wordBreak: "break-all",
                    display: "block", maxWidth: "100%",
                  }}
                >
                  {truncateHex(msg.fingerprint)}
                </span>
              </div>
            )}

            {/* Delivery status row */}
            {msg.status && (
              <div style={{
                marginTop: 4, display: "flex",
                alignItems: "center", gap: 6,
              }}>
                <span style={{ color: "var(--info)" }}>Delivery:</span>
                <span style={{
                  color: msg.status === "read"      ? "var(--accent)"
                    : msg.status === "delivered"    ? "var(--text-secondary)"
                    : "var(--text-muted)",
                }}>
                  {msg.status}
                </span>
              </div>
            )}

            <div style={{
              marginTop: 4, color: "var(--text-muted)", fontSize: 9,
            }}>
              Click message to collapse
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
