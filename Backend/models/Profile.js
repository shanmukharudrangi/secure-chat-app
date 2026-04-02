const mongoose = require("mongoose");

/**
 * Profile
 * One-to-one relationship with User.
 * Stores user-facing display information separate from auth/identity data.
 */
const ProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true   // ensures one profile per user
  },
  name: {
    type: String,
    required: [true, "Name is required"],
    trim: true,
    maxlength: [50, "Name must be 50 characters or fewer"]
  },
  avatar: {
    type: String,
    default: "",   // optional URL / base64 / filename
    trim: true
  },
  bio: {
    type: String,
    default: "",
    trim: true,
    maxlength: [200, "Bio must be 200 characters or fewer"]
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Profile", ProfileSchema);
