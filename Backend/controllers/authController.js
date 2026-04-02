const OTP = require("../models/OTP");
const User = require("../models/User");
const generateOTP = require("../utils/otp");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const sendEmail = require("../services/emailService");
const { logSecurityEvent } = require("../utils/integrityService");

function normalizeEmail(value = "") {
  return value.trim().toLowerCase();
}

/*
  NOTE: RSA key pairs are generated in the BROWSER (Web Crypto API).
  The backend only stores the PUBLIC key.
  The private key is stored client-side (localStorage) and NEVER sent to the server.

  Flow:
  1. User enters email/phone → OTP sent
  2. User verifies OTP
  3. If NEW user: frontend generates RSA keypair, sends publicKey to backend on first message send
  4. If EXISTING user: frontend loads private key from localStorage
*/

exports.sendOTP = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.identifier);
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }
    if (!email.includes("@")) {
      return res.status(400).json({ error: "A valid email address is required" });
    }

    const otp = generateOTP();

    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await OTP.deleteMany({ identifier: email });
    await OTP.create({ identifier: email, otpHash, expiresAt, type: "email" });
    await sendEmail(email, otp);

    res.json({ message: "OTP sent successfully" });
  } catch (error) {
    console.error("sendOTP error:", error);
    res.status(500).json({ error: "Failed to send OTP" });
  }
};

exports.verifyOTP = async (req, res) => {
  try {
    const { otp, publicKey } = req.body;
    const email = normalizeEmail(req.body.identifier);
    // publicKey is optional on first call — sent by frontend after generating RSA keys

    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "A valid email address is required" });
    }

    const record = await OTP.findOne({ identifier: email }).sort({ createdAt: -1 });
    if (!record) return res.status(400).json({ error: "OTP not found. Request a new one." });
    if (record.expiresAt < new Date()) return res.status(400).json({ error: "OTP expired" });

    const isValid = await bcrypt.compare(otp, record.otpHash);
    if (!isValid) return res.status(400).json({ error: "Invalid OTP" });

    let user;
    let isNewUser = false;

    user = await User.findOne({ email });

    if (!user) {
      isNewUser = true;
      const userData = {
        email,
        displayName: email.split("@")[0],
      };
      if (publicKey) userData.publicKey = publicKey;
      if (req.body.signingPublicKey) userData.signingPublicKey = req.body.signingPublicKey;

      user = await User.create(userData);
    } else if (publicKey) {
      // Existing user logging in from a new device or cleared cache
      // Overwrite the old public key with the newly generated one
      user.publicKey = publicKey;
      if (req.body.signingPublicKey) user.signingPublicKey = req.body.signingPublicKey;
      await user.save();
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
    await OTP.deleteMany({ identifier: email });
    await logSecurityEvent(
      user._id,
      "LOGIN",
      "OTP verified and session created",
      { identifier: email, isNewUser }
    );

    res.json({
      message: "Login successful",
      token,
      userId: user._id,
      isNewUser,
      keyUpdated: !!publicKey, // Tell frontend to store the new private key
      user: {
        _id: user._id,
        email: user.email,
        username: user.username,
        phone: user.phone,
        displayName: user.displayName,
        avatar: user.avatar,
        bio: user.bio,
        publicKey: user.publicKey,
        signingPublicKey: user.signingPublicKey,
        isProfileCompleted: user.isProfileCompleted
      }
    });
  } catch (error) {
    console.error("verifyOTP error:", error);
    res.status(500).json({ error: "OTP verification failed" });
  }
};

// Called after RSA key generation to store public key
exports.registerPublicKey = async (req, res) => {
  try {
    const { publicKey, signingPublicKey } = req.body;
    if (!publicKey && !signingPublicKey) return res.status(400).json({ error: "Public keys required" });

    if (publicKey) req.user.publicKey = publicKey;
    if (signingPublicKey) req.user.signingPublicKey = signingPublicKey;
    await req.user.save();

    res.json({ message: "Public keys registered", publicKey, signingPublicKey });
  } catch (error) {
    console.error("registerPublicKey error:", error);
    res.status(500).json({ error: "Failed to register public key" });
  }
};
