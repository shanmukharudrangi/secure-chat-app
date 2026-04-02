const { GoogleGenerativeAI } = require("@google/generative-ai");

const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || "").trim();
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

const rateLimitStore = new Map();
const RATE_LIMIT_MAX = 15;
const RATE_LIMIT_WINDOW = 60_000;

function buildCurrentDateContext() {
  const timeZone =
    process.env.AI_TIMEZONE ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC";
  const now = new Date();

  const fullDate = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone,
  }).format(now);

  const time = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(now);

  return { timeZone, fullDate, time };
}

function checkRateLimit(userId) {
  const now = Date.now();
  const record = rateLimitStore.get(userId);

  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW) {
    rateLimitStore.set(userId, { count: 1, windowStart: now });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }

  if (record.count >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil(
      (RATE_LIMIT_WINDOW - (now - record.windowStart)) / 1000
    );
    return { allowed: false, retryAfter };
  }

  record.count += 1;
  return { allowed: true, remaining: RATE_LIMIT_MAX - record.count };
}

exports.chat = async (req, res) => {
  try {
    if (!GEMINI_API_KEY || !genAI) {
      console.error("[AI] Missing GEMINI_API_KEY in environment");
      return res.status(500).json({
        error: "AI is not configured. Add GEMINI_API_KEY in the backend .env file.",
      });
    }

    const userId = req.user._id.toString();
    const { message, conversationHistory = [] } = req.body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    const trimmed = message.trim();
    if (trimmed.length > 2000) {
      return res.status(400).json({
        error: "Message too long (max 2000 characters)",
      });
    }

    const limit = checkRateLimit(userId);
    if (!limit.allowed) {
      return res.status(429).json({
        error: `Rate limit exceeded. Try again in ${limit.retryAfter} seconds.`,
        retryAfter: limit.retryAfter,
      });
    }

    const history = conversationHistory
      .filter(
        (m) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.trim().length > 0
      )
      .slice(-6)
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content.trim() }],
      }));

    const currentDateContext = buildCurrentDateContext();

    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction:
        "You are a helpful AI assistant built into SecureChat, an end-to-end encrypted messaging app. " +
        "Keep responses conversational but highly organized. " +
        "When providing multiple suggestions, instructions, or tips, ALWAYS use bullet points (•) or numbered lists. " +
        "Break long explanations into short paragraphs for readability. " +
        "You do not have access to users' encrypted messages and must never claim that you do. " +
        `Current app date context: ${currentDateContext.fullDate}. ` +
        `Current app time context: ${currentDateContext.time}. ` +
        `Current app timezone: ${currentDateContext.timeZone}. ` +
        "When the user asks about the current date, day, time, today, yesterday, or tomorrow, use this exact current context instead of guessing. " +
        "If timezone matters, mention that your answer is based on the app timezone above.",
    });

    const chat = model.startChat({ history });
    const result = await chat.sendMessage(trimmed);
    const reply = result.response.text().trim();

    if (!reply) {
      return res.status(502).json({ error: "AI returned an empty response" });
    }

    return res.json({
      reply,
      remaining: limit.remaining,
    });
  } catch (error) {
    const status = error?.status || error?.response?.status || 500;
    const rawMessage = String(error?.message || "").trim();
    const lowerMessage = rawMessage.toLowerCase();

    if (status === 429 || lowerMessage.includes("quota") || lowerMessage.includes("rate")) {
      console.error("[AI] Gemini 429:", rawMessage || error);
      return res.status(429).json({
        error: rawMessage || "AI free tier quota reached. Try again tomorrow or upgrade your Gemini plan.",
      });
    }

    if (
      status === 400 &&
      (rawMessage.includes("API key") || rawMessage.includes("API_KEY_INVALID"))
    ) {
      console.error("[AI] Invalid Gemini API key");
      return res.status(500).json({ error: "AI service configuration error" });
    }

    if (
      rawMessage.includes("fetch failed") ||
      rawMessage.includes("ENOTFOUND") ||
      rawMessage.includes("ECONNRESET") ||
      rawMessage.includes("ETIMEDOUT")
    ) {
      console.error("[AI] Gemini network error:", rawMessage || error);
      return res.status(502).json({
        error: "AI provider is unreachable from the server. Check internet access, DNS, firewall, or host restrictions.",
      });
    }

    console.error("[AI] Gemini chat error:", rawMessage || error);
    return res.status(500).json({ error: "AI request failed. Please try again." });
  }
};
