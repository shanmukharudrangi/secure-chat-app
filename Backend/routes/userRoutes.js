const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const { getPublicKey, getUserProfile, getAllUsers, searchUsers, updateProfile, getMe, checkProfile } = require("../controllers/userController");

// Profile status check — must be defined before /:id routes to avoid conflicts
router.get("/check-profile", authMiddleware, checkProfile);

router.get("/me", authMiddleware, getMe);
router.get("/search", authMiddleware, searchUsers);
router.get("/", authMiddleware, getAllUsers);
router.get("/:id/publicKey", authMiddleware, getPublicKey);
router.get("/:id", authMiddleware, getUserProfile);
router.patch("/profile", authMiddleware, updateProfile);

module.exports = router;
