const express = require("express");
const router = express.Router();
const { sendOTP, verifyOTP, registerPublicKey } = require("../controllers/authController");
const authMiddleware = require("../middleware/authMiddleware");
const { authOtpLimiter, authVerifyLimiter } = require("../middleware/rateLimitMiddleware");

router.post("/send-otp", authOtpLimiter, sendOTP);
router.post("/verify-otp", authVerifyLimiter, verifyOTP);
router.post("/register-key", authMiddleware, registerPublicKey);

module.exports = router;
