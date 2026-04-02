import { useEffect, useState } from "react";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";

const SEV_COLOR = {
  low: "#00ff88", medium: "#ffaa00", high: "#ff6644", critical: "#ff2255"
};

const EVENT_ICON = {
  MESSAGE_SENT: "📤", TAMPER_DETECTED: "🚨", LOGIN: "🔑"
};

export default function SecurityPanel() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, []);

  async function load() {
    try {
      const data = await api.get("/security/my-logs");
      if (Array.isArray(data)) setLogs(data);
    } catch (e) {}
    setLoading(false);
  }

  const tampered = logs.filter(l => l.eventType === "TAMPER_DETECTED").length;
  const sent = logs.filter(l => l.eventType === "MESSAGE_SENT").length;

  return (
    <div style={{
      width: 280, flexShrink: 0,
      background: "var(--bg-1)", borderLeft: "1px solid var(--border)",
      display: "flex", flexDirection: "column", height: "100%",
      animation: "slideIn 0.2s ease"
    }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 16 }}>🛡</span>
          <span style={{ fontFamily: "var(--font-accent)", fontWeight: 700, fontSize: 13 }}>
            Security Monitor
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <StatCard label="Sent" value={sent} color="var(--accent)" />
          <StatCard
            label={tampered > 0 ? "⚠ Tampered!" : "Tamper Events"}
            value={tampered}
            color={tampered > 0 ? "var(--danger)" : "var(--text-muted)"}
            alert={tampered > 0}
          />
        </div>
      </div>

      <div style={{
        padding: "6px 16px 4px", fontSize: 10, fontFamily: "var(--font-accent)",
        color: "var(--text-muted)", letterSpacing: 2, textTransform: "uppercase"
      }}>
        Recent Events
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && (
          <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
            Loading...
          </div>
        )}

        {logs.map((log, i) => (
          <div key={i} style={{
            padding: "9px 16px", borderBottom: "1px solid var(--border)",
            animation: "fadeIn 0.2s"
          }}>
            <div style={{ display: "flex", gap: 8 }}>
              <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>
                {EVENT_ICON[log.eventType] || "📋"}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 2 }}>
                  <SevBadge sev={log.severity} />
                  <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-accent)" }}>
                    {new Date(log.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>
                  {log.eventType.replace(/_/g, " ")}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                  {log.description}
                </div>
              </div>
            </div>
          </div>
        ))}

        {!loading && logs.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
            No security events yet
          </div>
        )}
      </div>

      <div style={{
        padding: "8px 16px", borderTop: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "space-between"
      }}>
        <span style={{ fontSize: 9, fontFamily: "var(--font-accent)", color: "var(--text-muted)" }}>
          Auto-refresh 10s
        </span>
        <button
          onClick={load}
          style={{
            background: "var(--bg-3)", border: "1px solid var(--border)",
            borderRadius: 4, padding: "2px 8px", fontSize: 10,
            color: "var(--text-secondary)", cursor: "pointer", fontFamily: "var(--font-accent)"
          }}
        >
          ↺ Refresh
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value, color, alert }) {
  return (
    <div style={{
      background: alert ? "rgba(255,68,102,0.08)" : "var(--bg-3)",
      border: `1px solid ${alert ? "rgba(255,68,102,0.3)" : "var(--border)"}`,
      borderRadius: 8, padding: "8px 12px"
    }}>
      <div style={{ fontSize: 22, fontFamily: "var(--font-accent)", fontWeight: 700, color }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function SevBadge({ sev }) {
  const color = SEV_COLOR[sev] || "var(--text-muted)";
  return (
    <span style={{
      fontSize: 8, fontFamily: "var(--font-accent)", color,
      background: `${color}22`, padding: "1px 5px", borderRadius: 3,
      textTransform: "uppercase", letterSpacing: 0.5
    }}>
      {sev || "low"}
    </span>
  );
}
