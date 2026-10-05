const express = require("express");
const router = express.Router();
const Shop = require("../models/Shop");

// same auth fallback pattern as customerReports.js
let requireAuth;
try {
  requireAuth = require("../middleware/auth");
  if (typeof requireAuth !== "function") requireAuth = requireAuth.verifyToken || requireAuth.auth || requireAuth.protect;
} catch (e) {
  console.warn("shopVerification: auth middleware not found:", e.message);
}
if (typeof requireAuth !== "function") {
  requireAuth = (req, res) => res.status(503).json({ error: "Auth middleware not configured" });
}

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const MAX_PHOTO_CHARS = 700000; // ~500KB per photo after base64

// Current verification status of the logged-in user's shop
router.get("/status", requireAuth, async (req, res) => {
  try {
    const shop = await Shop.findOne({ shopId: req.user.shopId }).select("verification.status verification.rejectReason");
    if (!shop) return res.status(404).json({ error: "Shop not found" });
    res.json({
      status: shop.verification?.status || "approved",
      rejectReason: shop.verification?.rejectReason || "",
    });
  } catch (err) {
    console.error("Verification status error:", err.message);
    res.status(500).json({ error: "Failed to fetch status" });
  }
});

// Submit (or re-submit) verification details
router.post("/", requireAuth, async (req, res) => {
  try {
    const gstin = String(req.body.gstin || "").trim().toUpperCase();
    const address = String(req.body.address || "").trim();
    const photos = Array.isArray(req.body.photos) ? req.body.photos : [];

    if (gstin && !GSTIN_RE.test(gstin)) {
      return res.status(400).json({ error: "Invalid GSTIN format" });
    }
    if (address.length < 10) {
      return res.status(400).json({ error: "Please enter the full shop address" });
    }
    if (photos.length < 1 || photos.length > 3) {
      return res.status(400).json({ error: "Upload 1 to 3 shop photos" });
    }
    for (const p of photos) {
      if (typeof p !== "string" || !p.startsWith("data:image/jpeg;base64,") || p.length > MAX_PHOTO_CHARS) {
        return res.status(400).json({ error: "Invalid or too large photo" });
      }
    }

    const shop = await Shop.findOne({ shopId: req.user.shopId });
    if (!shop) return res.status(404).json({ error: "Shop not found" });
    if (shop.verification?.status === "approved" && shop.verification?.reviewedAt) {
      return res.status(400).json({ error: "Shop is already approved" });
    }

    shop.verification = {
      status: "pending",
      gstin,
      address,
      photos,
      submittedAt: new Date(),
      reviewedAt: null,
      rejectReason: "",
    };
    if (gstin) shop.gstin = gstin;
    await shop.save();

    res.json({ success: true, status: "pending" });
  } catch (err) {
    console.error("Verification submit error:", err.message);
    res.status(500).json({ error: "Failed to submit verification" });
  }
});

module.exports = router;