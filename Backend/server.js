const express = require("express");
const http    = require("http");
const path    = require("path");
const cors    = require("cors");
const { Server } = require("socket.io");

require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const connectDB        = require("./config/db");
const authRoutes       = require("./routes/authRoutes");
const messageRoutes    = require("./routes/messageRoutes");
const userRoutes       = require("./routes/userRoutes");
const securityRoutes   = require("./routes/securityRoutes");
const profileRoutes    = require("./routes/profileRoutes");
const aiRoutes         = require("./routes/aiRoutes");
const socketHandler    = require("./socket/socketHandler");

const app    = express();
const server = http.createServer(app);

// Render runs behind a proxy, so trust forwarded IP headers in production.
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

// ── CORS ───────────────────────────────────────────────────────────────────
// Lock down to the frontend origin in all environments.
// Set CLIENT_URL in .env for production (e.g. https://yourdomain.com).
const rawClientUrls = process.env.CLIENT_URL || "http://localhost:3000";
const clientUrls = rawClientUrls.split(",").map((url) => url.trim()).filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || clientUrls.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("CORS origin not allowed"));
  },
  credentials: true,
  methods:     ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
};

// ── Socket.IO ──────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin:      clientUrls,
    methods:     ["GET", "POST"],
    credentials: true,
  },
});

// ── Database + Socket ──────────────────────────────────────────────────────
connectDB();
socketHandler(io);

// ── Global middleware ──────────────────────────────────────────────────────
app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));    // guard against oversized payloads

// ── REST routes ────────────────────────────────────────────────────────────
app.use("/api/auth",     authRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/users",    userRoutes);
app.use("/api/security", securityRoutes);
app.use("/api/profile",  profileRoutes);
app.use("/api/ai",       aiRoutes);         // ← AI integration

// ── Health check ───────────────────────────────────────────────────────────
const frontendDist = path.resolve(__dirname, "..", "frontend", "dist");
if (process.env.NODE_ENV === "production") {
  app.use(express.static(frontendDist));
}

app.get("/health", (req, res) => {
  res.json({
    status:    "Server running",
    timestamp: new Date().toISOString(),
  });
});

if (process.env.NODE_ENV === "production") {
  app.get(/^\/(?!api|socket\.io|health).*/, (req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

// ── 404 handler ────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ── Global error handler ───────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("[Server] Unhandled error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`[Server] Running on port ${PORT} | Clients: ${clientUrls.join(", ")}`);
});
