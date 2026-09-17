// ── UPDATED SERVER.JS WITH MULTI-SHOP SUPPORT ──────────────────────────
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config();
const { Cashfree, CFEnvironment } = require("cashfree-pg");

// Import routers
const discountPermissionsRoute = require("./routes/discountPermissions");
const multiShopRouter = require("./multiShopRouter");
const chatRouter = require("./routes/chat");
const ordersRouter = require("./routes/orders");
const productsRouter = require("./routes/products");
const reportsRoute = require("./routes/reports");
const reportChatRouter = require("./routes/reportChat");
const authRouter = require("./routes/auth");
const settingsRouter = require("./routes/settings");
const voiceProductRouter = require("./routes/voiceProduct");
const voiceInvoiceRoute = require("./routes/voiceInvoice");
const invoicesRoute = require("./routes/invoices");
const suppliersRoute = require("./routes/suppliers");
const notificationsRoute = require("./routes/notifications");
const supplierPurchasesRouter = require("./routes/supplierPurchases");
const superAdminRouter = require("./routes/superadmin");
const tasksRouter = require("./routes/tasks");
const restockOrdersRouter = require("./routes/restockOrders");
const paymentsRouter = require("./routes/payments"); // Cashfree create-order/order-status
const Shop = require("./models/Shop");
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

// ── CASHFREE CLIENT ──────────────────────────────────────────────────────
const cashfree = new Cashfree(
  process.env.CASHFREE_ENV === "PRODUCTION" ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX,
  process.env.CASHFREE_CLIENT_ID,
  process.env.CASHFREE_CLIENT_SECRET
);

// ── CASHFREE WEBHOOK (must come BEFORE express.json()) ──────────────────
// Signature verification needs the raw, unparsed request body. If this
// route were registered after app.use(express.json()), the body would
// already be parsed into an object and verification would fail.
//
// NOTE: this used to be registered TWICE in this file — once as a
// "log-only" stub (before express.json()) and once with the real
// Shop.findOneAndUpdate logic (after express.json(), further down).
// Express matches routes in registration order and the first matching
// handler sends the response, so the first (stub) handler always won and
// called res.sendStatus(200) before the real update logic ever ran.
// Cashfree saw a 200 and considered the webhook delivered, but
// Shop.subscription was NEVER updated by it. That's why the plan looked
// like it was "changing on its own" / not updating on payment — the only
// thing actually writing the plan was the best-effort order-status check
// that runs client-side after redirect (Subscription.jsx), which is a
// fallback, not the source of truth. This is the single, real handler now.
app.post("/api/payments/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  try {
    cashfree.PGVerifyWebhookSignature(
      req.headers["x-webhook-signature"],
      req.body,
      req.headers["x-webhook-timestamp"]
    );
    const event = JSON.parse(req.body.toString());
    console.log("Verified webhook:", event.type, event.data?.order?.order_id);

    const order = event.data?.order;
    const payment = event.data?.payment;

    // ── Sirf successful payment pe hi subscription credit karo ──────────
    if (event.type === "PAYMENT_SUCCESS_WEBHOOK" && order && payment?.payment_status === "SUCCESS") {
      const PLAN_ID_MAP = { starter: "free", pro: "pro", enterprise: "premium" };
      const [shopId, planId, cycle] = (order.order_note || "").split("|");
      const mappedPlan = PLAN_ID_MAP[planId];

      if (shopId && mappedPlan) {
        // Idempotency check — same order dobara process na ho
        const alreadyRecorded = await Shop.exists({
          shopId,
          "subscription.renewalHistory.orderId": order.order_id,
        });

        if (!alreadyRecorded) {
          await Shop.findOneAndUpdate(
            { shopId },
            {
              $set: {
                "subscription.plan": mappedPlan,
                "subscription.monthlyAmount": cycle === "yearly"
                  ? Math.round(order.order_amount / 12)
                  : order.order_amount,
              },
              $push: {
                "subscription.renewalHistory": {
                  date: new Date(),
                  amount: order.order_amount,
                  plan: mappedPlan,
                  orderId: order.order_id,
                },
              },
            }
          );
          console.log(`✅ Subscription updated for ${shopId}: ${mappedPlan} (₹${order.order_amount})`);
        } else {
          console.log(`Webhook already processed for order ${order.order_id}, skipping`);
        }
      } else {
        console.warn("Webhook order_note missing/invalid shopId or plan:", order.order_note);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook verification failed:", err.message);
    res.status(400).send("Invalid signature");
  }
});

app.use(express.json());

// ── DATABASE CONNECTION (serverless-safe: cache + reuse across invocations) ──
// In serverless (Vercel), each cold start re-runs this file. Without caching,
// a new connection attempt fires on every invocation, and requests that land
// on a "connecting" instance can time out waiting (the buffering error you saw).
// This caches the connection promise so concurrent/repeat invocations reuse it.
let cachedConnectionPromise = null;

function connectToDatabase() {
  if (!process.env.MONGO_URI) {
    console.log("⚠️ Using in-memory data (MONGO_URI not set)");
    return null;
  }

  // Already connected — reuse it
  if (mongoose.connection.readyState === 1) {
    return Promise.resolve(mongoose.connection);
  }

  // Already connecting — reuse the in-flight promise instead of starting a new one
  if (cachedConnectionPromise) {
    return cachedConnectionPromise;
  }

  cachedConnectionPromise = mongoose
    .connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 8000, // stay safely under Vercel's function limit
      socketTimeoutMS: 45000,
    })
    .then((conn) => {
      console.log("MongoDB Connected 🚀");
      return conn;
    })
    .catch((err) => {
      console.error("MongoDB Error:", err.message);
      cachedConnectionPromise = null; // allow retry on the next request
      throw err;
    });

  return cachedConnectionPromise;
}

// Ensure a DB connection exists before handling any /api request —
// EXCEPT preflight (OPTIONS), which never touches the DB and must return
// instantly or Vercel can kill the function before a CORS header goes out.
app.use("/api", async (req, res, next) => {
  if (req.method === "OPTIONS") return next();
  if (!process.env.MONGO_URI) return next(); // in-memory mode, nothing to wait for
  try {
    await connectToDatabase();
    next();
  } catch (err) {
    res.status(503).json({ error: "Database connection failed, please retry" });
  }
});

// Kick off an initial connection attempt at cold start too (non-blocking)
connectToDatabase();

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
app.use("/api/reports", reportsRoute);
app.use("/api/report-chat", reportChatRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/auth", authRouter);
app.use("/api/voice-product", voiceProductRouter);
app.use("/api/voice-invoice", voiceInvoiceRoute);
app.use("/api/invoices", invoicesRoute);
app.use("/api/suppliers", suppliersRoute);
app.use("/api/notifications", notificationsRoute);
app.use("/api/supplier-purchases", supplierPurchasesRouter);
app.use("/api/discount-permissions", discountPermissionsRoute);
app.use("/api/sa-x7k9q2", superAdminRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/restock-orders", restockOrdersRouter);
app.use("/api/payments", paymentsRouter); // Cashfree create-order/order-status

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