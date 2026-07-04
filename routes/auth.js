const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const Shop = require("../models/Shop");

// ── SIGNUP AS OWNER (creates a brand new shop) ────────────────────────────
router.post("/signup-owner", async (req, res) => {
  try {
    const { name, email, password, shopName } = req.body;

    if (!name || !email || !password || !shopName) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: "Email already registered" });
    }

    // Naya unique shopId generate karo
    const shopId = "shop_" + crypto.randomBytes(5).toString("hex");

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role: "owner",
      shopId,
    });

    await Shop.create({
      shopId,
      shopName,
      ownerId: user._id,
    });

    const token = jwt.sign(
      { userId: user._id, shopId: user.shopId, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      token,
      user: { name: user.name, email: user.email, role: user.role, shopId: user.shopId },
      shopId, // ← ye owner ko dikhana zaroori hai, staff isi se join karenge
    });
  } catch (err) {
    console.error("Signup owner error:", err.message);
    res.status(500).json({ error: "Signup failed" });
  }
});

// ── SIGNUP AS STAFF (joins an existing shop via shopId) ───────────────────
router.post("/signup-staff", async (req, res) => {
  try {
    const { name, email, password, shopId } = req.body;

    if (!name || !email || !password || !shopId) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const shop = await Shop.findOne({ shopId });
    if (!shop) {
      return res.status(404).json({ error: "Invalid Shop ID — shop not found" });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role: "staff",
      shopId,
    });

    const token = jwt.sign(
      { userId: user._id, shopId: user.shopId, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      token,
      user: { name: user.name, email: user.email, role: user.role, shopId: user.shopId },
    });
  } catch (err) {
    console.error("Signup staff error:", err.message);
    res.status(500).json({ error: "Signup failed" });
  }
});

// ── LOGIN (owner or staff, same route) ────────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign(
      { userId: user._id, shopId: user.shopId, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      token,
      user: { name: user.name, email: user.email, role: user.role, shopId: user.shopId },
    });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: "Login failed" });
  }
});

module.exports = router;