const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const {
  sendMessage,
  getMessages,
  getConversations,
  deleteMessage,
  deleteMessageForEveryone,
  clearChat,
  deleteChat,
  togglePinConversation,
  toggleArchiveConversation,
  toggleStarMessage,
} = require("../controllers/messageController");

router.post("/send", authMiddleware, sendMessage);
router.get("/chat/:userId", authMiddleware, getMessages);
router.delete("/chat/:userId/clear", authMiddleware, clearChat);
router.delete("/chat/:userId", authMiddleware, deleteChat);
router.patch("/chat/:userId/pin", authMiddleware, togglePinConversation);
router.patch("/chat/:userId/archive", authMiddleware, toggleArchiveConversation);
router.get("/conversations", authMiddleware, getConversations);
router.patch("/:messageId/star", authMiddleware, toggleStarMessage);
router.delete("/:messageId/everyone", authMiddleware, deleteMessageForEveryone);
router.delete("/:messageId", authMiddleware, deleteMessage);

module.exports = router;
