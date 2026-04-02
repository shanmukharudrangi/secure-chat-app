const User = require("../models/User");

function normalizeUsername(value = "") {
  return value.trim();
}

exports.getPublicKey = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({
      userId: user._id,
      publicKey: user.publicKey,
      signingPublicKey: user.signingPublicKey
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch public key" });
  }
};

exports.getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select("email username displayName avatar bio isOnline lastSeen createdAt");
    if (!user) return res.status(404).json({ error: "User not found" });
    return res.json(user);
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch user profile" });
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const users = await User.find({ _id: { $ne: currentUserId } })
      .select("email phone username displayName avatar bio publicKey signingPublicKey isOnline lastSeen createdAt");
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
};

exports.searchUsers = async (req, res) => {
  try {
    const currentUserId = req.user._id;
    const query = normalizeUsername(req.query.username || "");

    if (query.length < 2) {
      return res.status(400).json({ error: "Enter at least 2 characters" });
    }

    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const users = await User.find({
      _id: { $ne: currentUserId },
      $or: [
        { username: { $regex: escaped, $options: "i" } },
        { displayName: { $regex: escaped, $options: "i" } },
        { email: { $regex: escaped, $options: "i" } }
      ]
    })
      .select("email username displayName avatar bio publicKey signingPublicKey isOnline lastSeen createdAt")
      .sort({ username: 1 })
      .limit(20);

    return res.json(users);
  } catch (error) {
    console.error("searchUsers error:", error);
    return res.status(500).json({ error: "Failed to search users" });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { displayName, username, avatar = "", bio = "", signingPublicKey } = req.body;
    if (!displayName || !displayName.trim()) {
      return res.status(400).json({ error: "Display name is required" });
    }
    const normalizedUsername = normalizeUsername(username || "");
    if (!normalizedUsername) {
      return res.status(400).json({ error: "Username is required" });
    }
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(normalizedUsername)) {
      return res.status(400).json({ error: "Username must be 3-30 characters using letters, numbers, or underscores" });
    }
    if (bio.length > 200) {
      return res.status(400).json({ error: "Bio must be 200 characters or fewer" });
    }
    const escapedUsername = normalizedUsername.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const existingUser = await User.findOne({
      username: { $regex: new RegExp(`^${escapedUsername}$`, "i") },
      _id: { $ne: req.user._id },
    }).select("_id");
    if (existingUser) {
      return res.status(409).json({ error: "Username is already taken" });
    }
    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        displayName: displayName.trim(),
        username: normalizedUsername,
        avatar: avatar.trim(),
        bio: bio.trim(),
        isProfileCompleted: true,
        signingPublicKey: signingPublicKey || req.user.signingPublicKey
      },
      { new: true }
    ).select("email phone username displayName avatar bio publicKey signingPublicKey isOnline isProfileCompleted");
    res.json(user);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: "Username is already taken" });
    }
    res.status(500).json({ error: "Failed to update profile" });
  }
};

exports.getMe = async (req, res) => {
  try {
    res.json({
      _id: req.user._id,
      email: req.user.email,
      username: req.user.username,
      phone: req.user.phone,
      displayName: req.user.displayName,
      avatar: req.user.avatar,
      bio: req.user.bio,
      publicKey: req.user.publicKey,
      signingPublicKey: req.user.signingPublicKey,
      isOnline: req.user.isOnline,
      isProfileCompleted: req.user.isProfileCompleted
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch profile" });
  }
};

// ─── Profile Check ────────────────────────────────────────────────────────────
// GET /api/users/check-profile
// Returns whether the authenticated user has completed their profile,
// along with the redirect path the frontend should use.
exports.checkProfile = async (req, res) => {
  try {
    // Re-fetch from DB so the status is always fresh (not stale from token payload)
    const user = await User.findById(req.user._id).select("isProfileCompleted displayName");

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!user.isProfileCompleted) {
      return res.status(200).json({
        profileCompleted: false,
        redirect: "/create-profile",
        message: "Profile setup is incomplete. Please complete your profile."
      });
    }

    return res.status(200).json({
      profileCompleted: true,
      redirect: "/dashboard",
      message: "Profile is complete. Access granted.",
      displayName: user.displayName
    });
  } catch (error) {
    console.error("checkProfile error:", error);
    res.status(500).json({ error: "Profile check failed. Please try again." });
  }
};
