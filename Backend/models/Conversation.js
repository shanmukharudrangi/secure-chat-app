const mongoose = require("mongoose");

const ConversationSchema = new mongoose.Schema({
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
  hiddenFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  pinnedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  archivedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Conversation", ConversationSchema);
