const { rateLimit } = require("express-rate-limit");

const authOtpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many OTP requests. Please wait before trying again." },
});

const authVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many verification attempts. Please wait before trying again." },
});

module.exports = {
  authOtpLimiter,
  authVerifyLimiter,
};
