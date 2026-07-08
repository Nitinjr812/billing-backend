const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const Shop = require("../models/Shop");
const sendVerificationEmail = require("../utils/sendEmail");

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

const makeToken = () => crypto.randomBytes(32).toString("hex");
const tokenExpiry = () => Date.now() + 24 * 60 * 60 * 1000; // 24 hours

// ── SIGNUP AS OWNER ────────────────────────────────────────────────────
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

    const shopId = "shop_" + crypto.randomBytes(5).toString("hex");
    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationToken = makeToken();

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role: "owner",
      shopId,
      verificationToken,
      verificationTokenExpires: tokenExpiry(),
    });

    await Shop.create({ shopId, shopName, ownerId: user._id });

    const verifyLink = `${CLIENT_URL}/verify-email/${verificationToken}`;
    try {
      await sendVerificationEmail(user.email, verifyLink);
    } catch (emailErr) {
      console.error("Email sending failed:", emailErr.message);
      // user ban chuka hai, token DB me hai — resend-verification se dobara try ho sakta hai
    }

    res.json({
      success: true,
      message: "Signup ho gaya. Email pe verification link bheji gayi hai. Verify karke login karo.",
      shopId, // owner ko save karke rakhna hai, staff isi se join karenge
    });
  } catch (err) {
    console.error("Signup owner error:", err.message);
    res.status(500).json({ error: "Signup failed" });
  }
});

// ── SIGNUP AS STAFF ────────────────────────────────────────────────────
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
    const verificationToken = makeToken();

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role: "staff",
      shopId,
      verificationToken,
      verificationTokenExpires: tokenExpiry(),
    });

    const verifyLink = `${CLIENT_URL}/verify-email/${verificationToken}`;
    try {
      await sendVerificationEmail(user.email, verifyLink);
    } catch (emailErr) {
      console.error("Email sending failed:", emailErr.message);
    }

    res.json({
      success: true,
      message: "Signup ho gaya. Email pe verification link bheji gayi hai. Verify karke login karo.",
    });
  } catch (err) {
    console.error("Signup staff error:", err.message);
    res.status(500).json({ error: "Signup failed" });
  }
});

// ── VERIFY EMAIL ───────────────────────────────────────────────────────
router.get("/verify-email/:token", async (req, res) => {
  try {
    const { token } = req.params;

    const user = await User.findOne({
      verificationToken: token,
      verificationTokenExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ error: "Invalid ya expired link. Resend verification try karo." });
    }

    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationTokenExpires = undefined;
    await user.save();

    // Verify hote hi auto-login kar do, taaki user seedha dashboard pe jaa sake
    const jwtToken = jwt.sign(
      { userId: user._id, shopId: user.shopId, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      message: "Email verified!",
      token: jwtToken,
      user: { name: user.name, email: user.email, role: user.role, shopId: user.shopId },
    });
  } catch (err) {
    console.error("Verify email error:", err.message);
    res.status(500).json({ error: "Verification failed" });
  }
});

// ── RESEND VERIFICATION ────────────────────────────────────────────────
router.post("/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.isVerified) return res.status(400).json({ error: "Email already verified" });

    user.verificationToken = makeToken();
    user.verificationTokenExpires = tokenExpiry();
    await user.save();

    const verifyLink = `${CLIENT_URL}/verify-email/${user.verificationToken}`;
    await sendVerificationEmail(user.email, verifyLink);

    res.json({ success: true, message: "Verification email dobara bheji gayi" });
  } catch (err) {
    console.error("Resend verification error:", err.message);
    res.status(500).json({ error: "Resend failed" });
  }
});

// ── LOGIN ──────────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(401).json({ error: "Invalid email or password" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: "Invalid email or password" });

    if (!user.isVerified) {
      return res.status(403).json({
        error: "Email verify nahi hai. Inbox check karo ya verification link resend karo.",
        needsVerification: true,
        email: user.email,
      });
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