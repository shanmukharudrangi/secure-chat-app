const Profile = require("../models/Profile");
const User = require("../models/User");

function normalizeUsername(value = "") {
  return value.trim();
}

/**
 * POST /api/profile/create-profile
 * 
 * Creates a profile for the authenticated user.
 * 
 * Rules:
 *  - User must be authenticated (enforced by authMiddleware)
 *  - If isProfileCompleted is already true → 409 Conflict
 *  - `name` is required, max 50 chars
 *  - `avatar` is optional (URL / upload path)
 *  - `bio` is optional, max 200 chars
 * 
 * On success:
 *  - Creates a Profile document (userId, name, avatar, bio)
 *  - Updates the User document: displayName, avatar, bio, isProfileCompleted = true
 *  - Returns 201 with the new profile and updated user fields
 */
exports.createProfile = async (req, res) => {
  try {
    const userId = req.user._id;

    // ─── Guard: prevent re-creation ──────────────────────────────────────────
    if (req.user.isProfileCompleted) {
      return res.status(409).json({
        error: "Profile already created. You cannot recreate your profile."
      });
    }

    // ─── Input extraction ─────────────────────────────────────────────────────
    const { name, username, avatar = "", bio = "", publicKey, signingPublicKey } = req.body;
    const normalizedUsername = normalizeUsername(username || "");

    // ─── Validation ───────────────────────────────────────────────────────────
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Name is required" });
    }
    if (!normalizedUsername) {
      return res.status(400).json({ error: "Username is required" });
    }
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(normalizedUsername)) {
      return res.status(400).json({ error: "Username must be 3-30 characters using letters, numbers, or underscores" });
    }
    if (name.trim().length > 50) {
      return res.status(400).json({ error: "Name must be 50 characters or fewer" });
    }
    if (bio && bio.length > 200) {
      return res.status(400).json({ error: "Bio must be 200 characters or fewer" });
    }
    const escapedUsername = normalizedUsername.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const existingUser = await User.findOne({
      username: { $regex: new RegExp(`^${escapedUsername}$`, "i") },
      _id: { $ne: userId },
    }).select("_id");
    if (existingUser) {
      return res.status(409).json({ error: "Username is already taken" });
    }

    // ─── Create Profile document ──────────────────────────────────────────────
    const profile = await Profile.create({
      userId,
      name:   name.trim(),
      avatar: avatar.trim(),
      bio:    bio.trim()
    });

    // ─── Sync denormalized fields back onto User ──────────────────────────────
    // (keeps displayName/avatar/bio queryable from the User doc directly)
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        displayName:        name.trim(),
        username:           normalizedUsername,
        avatar:             avatar.trim(),
        bio:                bio.trim(),
        publicKey:          publicKey || req.user.publicKey,
        signingPublicKey:   signingPublicKey || req.user.signingPublicKey,
        isProfileCompleted: true
      },
      { new: true }
    ).select("username displayName avatar bio isProfileCompleted");

    return res.status(201).json({
      message: "Profile created successfully",
      profile: {
        name:   profile.name,
        avatar: profile.avatar,
        bio:    profile.bio
      },
      user: {
        username:           updatedUser.username,
        displayName:        updatedUser.displayName,
        avatar:             updatedUser.avatar,
        bio:                updatedUser.bio,
        isProfileCompleted: updatedUser.isProfileCompleted
      }
    });
  } catch (error) {
    console.error("createProfile error:", error);

    // Mongoose duplicate key — profile already exists in DB (belt-and-suspenders)
    if (error.code === 11000) {
      return res.status(409).json({
        error: "Username is already taken"
      });
    }

    // Mongoose validation errors (schema-level maxlength, required)
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ error: messages[0] });
    }

    res.status(500).json({ error: "Profile creation failed. Please try again." });
  }
};
