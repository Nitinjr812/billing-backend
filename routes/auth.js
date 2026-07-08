const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const Shop = require("../models/Shop");
const sendOTPEmail = require("../utils/sendEmail");

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();
const otpExpiry = () => Date.now() + 10 * 60 * 1000; // 10 minutes

const issueToken = (user) =>
  jwt.sign(
    { userId: user._id, shopId: user.shopId, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

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
    const otp = generateOTP();

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role: "owner",
      shopId,
      otp,
      otpExpires: otpExpiry(),
    });

    await Shop.create({ shopId, shopName, ownerId: user._id });

    await sendOTPEmail(user.email, otp, "signup");

    res.json({
      success: true,
      message: "OTP sent to your email. Please verify to continue.",
      email: user.email,
      shopId,
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
    if (!shop) return res.status(404).json({ error: "Invalid Shop ID — shop not found" });

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) return res.status(400).json({ error: "Email already registered" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const otp = generateOTP();

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role: "staff",
      shopId,
      otp,
      otpExpires: otpExpiry(),
    });

    await sendOTPEmail(user.email, otp, "signup");

    res.json({
      success: true,
      message: "OTP sent to your email. Please verify to continue.",
      email: user.email,
    });
  } catch (err) {
    console.error("Signup staff error:", err.message);
    res.status(500).json({ error: "Signup failed" });
  }
});

// ── VERIFY SIGNUP OTP (activates account + auto-login) ─────────────────
router.post("/verify-signup-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.isVerified) return res.status(400).json({ error: "Already verified" });
    if (!user.otp || user.otp !== otp || user.otpExpires < Date.now()) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    user.isVerified = true;
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    const token = issueToken(user);
    res.json({
      success: true,
      token,
      user: { name: user.name, email: user.email, role: user.role, shopId: user.shopId },
    });
  } catch (err) {
    console.error("Verify signup OTP error:", err.message);
    res.status(500).json({ error: "Verification failed" });
  }
});

// ── LOGIN STEP 1 (password check, sends login OTP) ──────────────────────
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
        error: "Account is not verified yet. Please verify your signup OTP first.",
        needsSignupVerification: true,
        email: user.email,
      });
    }

    const otp = generateOTP();
    user.otp = otp;
    user.otpExpires = otpExpiry();
    await user.save();

    await sendOTPEmail(user.email, otp, "login");

    res.json({
      success: true,
      otpRequired: true,
      message: "OTP sent to your email",
      email: user.email,
    });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: "Login failed" });
  }
});

// ── LOGIN STEP 2 (verify login OTP, issue token) ────────────────────────
router.post("/verify-login-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) return res.status(404).json({ error: "User not found" });
    if (!user.otp || user.otp !== otp || user.otpExpires < Date.now()) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    const token = issueToken(user);
    res.json({
      success: true,
      token,
      user: { name: user.name, email: user.email, role: user.role, shopId: user.shopId },
    });
  } catch (err) {
    console.error("Verify login OTP error:", err.message);
    res.status(500).json({ error: "Verification failed" });
  }
});

// ── RESEND OTP (works for signup/login stage) ────────────────────────────
router.post("/resend-otp", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: "User not found" });

    const otp = generateOTP();
    user.otp = otp;
    user.otpExpires = otpExpiry();
    await user.save();

    await sendOTPEmail(user.email, otp, "login");
    res.json({ success: true, message: "OTP resent" });
  } catch (err) {
    console.error("Resend OTP error:", err.message);
    res.status(500).json({ error: "Resend failed" });
  }
});

// ── FORGOT PASSWORD — STEP 1: request OTP ───────────────────────────────
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: "No account found with this email" });

    const otp = generateOTP();
    user.otp = otp;
    user.otpExpires = otpExpiry();
    await user.save();

    await sendOTPEmail(user.email, otp, "reset");

    res.json({ success: true, message: "OTP sent to your email", email: user.email });
  } catch (err) {
    console.error("Forgot password error:", err.message);
    res.status(500).json({ error: "Request failed" });
  }
});

// ── FORGOT PASSWORD — STEP 2: verify OTP + set new password ─────────────
router.post("/reset-password", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!user.otp || user.otp !== otp || user.otpExpires < Date.now()) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    res.json({ success: true, message: "Password reset successful. Please login." });
  } catch (err) {
    console.error("Reset password error:", err.message);
    res.status(500).json({ error: "Reset failed" });
  }
});

module.exports = router;