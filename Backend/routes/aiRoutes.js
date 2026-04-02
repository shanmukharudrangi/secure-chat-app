const express    = require("express");
const router     = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const { chat }   = require("../controllers/aiController");

// All AI endpoints require a valid JWT — no anonymous AI access
router.post("/chat", authMiddleware, chat);

module.exports = router;