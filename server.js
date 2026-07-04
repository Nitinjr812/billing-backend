// ── UPDATED SERVER.JS WITH MULTI-SHOP SUPPORT ──────────────────────────
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config();

// Import routers
const multiShopRouter = require("./multiShopRouter");
const chatRouter = require("./routes/chat");
const ordersRouter = require("./routes/orders");
const productsRouter = require("./routes/products");
const reportsRouter = require("./routes/reports");
const reportChatRouter = require("./routes/reportChat");
const authRouter = require("./routes/auth");

const app = express();

// ── MIDDLEWARE ──────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173",
    "https://firstbilling.vercel.app",
  ],
  credentials: true,
}));
app.use(express.json());

// ── DATABASE CONNECTION ────────────────────────────────────────────────
if (process.env.MONGO_URI) {
  mongoose
    .connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB Connected 🚀"))
    .catch((err) => console.log("MongoDB Error:", err));
} else {
  console.log("⚠️ Using in-memory data (MONGO_URI not set)");
}

// ── ROUTES ─────────────────────────────────────────────────────────────

// Home
app.get("/", (req, res) => {
  res.json({
    message: "Multi-Shop Billing Backend Running 🚀",
    endpoints: {
      shops: "/api/shops/shops",
      dashboard: "/api/shops/dashboard/:shopId",
      products: "/api/shops/products/:shopId",
      orders: "/api/shops/orders/:shopId",
      addProduct: "POST /api/shops/product/:shopId",
      addOrder: "POST /api/shops/order/:shopId",
      alerts: "/api/shops/alerts/:shopId",
    },
  });
});

// ── MULTI-SHOP ROUTES (NEW) ────────────────────────────────────────────
app.use("/api/shops", multiShopRouter);

// ── LEGACY ROUTES (FOR COMPATIBILITY) ──────────────────────────────────
app.use("/api/orders", ordersRouter);
app.use("/api/products", productsRouter);
app.use("/api/chat", chatRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/report-chat", reportChatRouter); 
app.use("/api/auth", authRouter); 
// ── ERROR HANDLING ────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Error:", err.message);
  res.status(500).json({ error: "Internal Server Error" });
});

// ── 404 HANDLER ───────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ── START SERVER ──────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || "development";

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║   🚀 Multi-Shop Billing Backend Running!          ║
╠════════════════════════════════════════════════════╣
║   Port: ${PORT}                                        ║
║   Env: ${NODE_ENV}                                      ║
║   API: http://localhost:${PORT}                  ║
║   WebSocket: Ready for real-time updates          ║
╚════════════════════════════════════════════════════╝
  `);
});

module.exports = app;