const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const { getSecurityLogs, getUserSecurityLogs, reportSecurityEvent } = require("../controllers/securityController");

router.get("/logs", authMiddleware, adminMiddleware, getSecurityLogs);
router.get("/my-logs", authMiddleware, getUserSecurityLogs);
router.post("/report-event", authMiddleware, reportSecurityEvent);

module.exports = router;
