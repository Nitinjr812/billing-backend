const jwt = require("jsonwebtoken");
const Shop = require("../models/Shop");

// ── Verify token + shop-active check, attach user info to req.user ──────
async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization; // format: "Bearer <token>"

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // ── NAYA: shop suspended check — har request pe ────────────────────
  try {
    const shop = await Shop.findOne({ shopId: decoded.shopId }).select("status suspendedReason");
    if (!shop) {
      return res.status(401).json({ error: "Shop not found", code: "SHOP_NOT_FOUND" });
    }
    if (shop.status === "suspended") {
      return res.status(403).json({
        error: "Your shop has been suspended. Please contact support.",
        code: "SHOP_SUSPENDED",
        reason: shop.suspendedReason || "",
      });
    }
  } catch (err) {
    return res.status(500).json({ error: "Failed to verify shop status" });
  }

  req.user = decoded; // { userId, shopId, role }
  next();
}

// ── Optional: restrict route to specific role(s) ─────────────────────────
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Not authorized for this action" });
    }
    next();
  };
}

module.exports = { verifyToken, requireRole };