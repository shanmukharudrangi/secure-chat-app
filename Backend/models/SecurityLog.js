const mongoose = require("mongoose");

const SecurityLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  eventType: { type: String, required: true },
  description: { type: String },
  metadata: { type: Object },
  severity: { type: String, enum: ["low", "medium", "high", "critical"], default: "low" },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("SecurityLog", SecurityLogSchema);
