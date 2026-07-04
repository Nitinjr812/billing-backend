const jwt = require("jsonwebtoken");

// ── Verify token, attach user info to req.user ──────────────────────────
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization; // format: "Bearer <token>"

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { userId, shopId, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
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