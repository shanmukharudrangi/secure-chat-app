const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const { createProfile } = require("../controllers/profileController");

// POST /api/profile/create-profile
// Only authenticated users may hit this endpoint.
router.post("/create-profile", authMiddleware, createProfile);

module.exports = router;
