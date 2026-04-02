const SecurityLog = require("../models/SecurityLog");

exports.getSecurityLogs = async (req, res) => {
  try {
    const logs = await SecurityLog.find().sort({ createdAt: -1 }).limit(100)
      .populate("userId", "email phone displayName");
    res.json(logs);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch logs" });
  }
};

exports.getUserSecurityLogs = async (req, res) => {
  try {
    const userId = req.user._id;
    const logs = await SecurityLog.find({ userId }).sort({ createdAt: -1 }).limit(50);
    res.json(logs);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch user logs" });
  }
};

exports.reportSecurityEvent = async (req, res) => {
  try {
    const { eventType, description, metadata } = req.body;
    const { logSecurityEvent } = require("../utils/integrityService");

    await logSecurityEvent(req.user._id, eventType, description, metadata);
    res.json({ success: true });
  } catch (error) {
    console.error("[securityController] reportSecurityEvent error:", error);
    res.status(500).json({ error: "Failed to report security event" });
  }
};
