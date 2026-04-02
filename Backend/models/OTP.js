const mongoose = require("mongoose");

const OTPSchema = new mongoose.Schema({
  identifier: { type: String, required: true },
  otpHash: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  type: { type: String, enum: ["email", "phone"] }
}, { timestamps: true });

module.exports = mongoose.model("OTP", OTPSchema);
