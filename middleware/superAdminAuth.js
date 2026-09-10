const jwt = require("jsonwebtoken");

function verifySuperAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.SUPERADMIN_JWT_SECRET || process.env.JWT_SECRET);
    if (decoded.type !== "superadmin") {
      return res.status(403).json({ error: "Not authorized" });
    }
    req.superAdmin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

module.exports = { verifySuperAdmin };