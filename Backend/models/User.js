const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  email: { type: String, unique: true, sparse: true },
  phone: { type: String, unique: true, sparse: true },
  username: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    minlength: 3,
    maxlength: 30,
    match: /^[a-zA-Z0-9_]+$/,
  },
  displayName: { type: String, default: "" },
  avatar: { type: String, default: "" },
  bio: { type: String, default: "", trim: true, maxlength: 200 },
  role: { type: String, enum: ["user", "admin"], default: "user" },
  publicKey: { type: String },
  signingPublicKey: { type: String },
  isProfileCompleted: { type: Boolean, default: false },
  isOnline: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("User", UserSchema);
