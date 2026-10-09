// ── UPDATED SERVER.JS WITH MULTI-SHOP SUPPORT + SUPER-ADMIN SECURITY ────
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
const tasksRouter = require("./routes/tasks");
const restockOrdersRouter = require("./routes/restockOrders");
const paymentsRouter = require("./routes/payments"); // Cashfree create-order/order-status
const customerReportsRouter = require("./routes/customerReports"); // shop se super-admin ko reports
const shopVerificationRouter = require("./routes/shopVerification");
const Shop = require("./models/Shop");

// ── SUPER ADMIN ─────────────────────────────────────────────────────────
// NOTE: routes/superadmin.js se `requireSuperAdmin` middleware export hona chahiye:
//   module.exports = router;  module.exports.requireSuperAdmin = requireSuperAdmin;
// (agar abhi export nahi hai to wahan add kar do — niche guard hai, crash nahi hoga)
const superAdminModule = require("./routes/superadmin");
const superAdminRouter = superAdminModule.router || superAdminModule;
const requireSuperAdmin = superAdminModule.requireSuperAdmin;
const saSecurityRouterFactory = require("./routes/saSecurity");

const app = express();

// Vercel/proxy ke peeche asli client IP (sessions + suspicious-login detection ke liye)
app.set("trust proxy", 1);

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

// ── DATABASE CONNECTION (serverless-safe: cache + reuse across invocations) ──
// Vercel pe har cold start me ye file dobara chalti hai. Connection promise
// cache karne se concurrent/repeat invocations wahi connection reuse karte hain.
let cachedConnectionPromise = null;

function connectToDatabase() {
  if (!process.env.MONGO_URI) {
    console.log("⚠️ Using in-memory data (MONGO_URI not set)");
    return Promise.resolve(null);
  }

  // Already connected — reuse
  if (mongoose.connection.readyState === 1) {
    return Promise.resolve(mongoose.connection);
  }

  // Already connecting — in-flight promise reuse karo
  if (cachedConnectionPromise) {
    return cachedConnectionPromise;
  }

  cachedConnectionPromise = mongoose
    .connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 8000, // Vercel function limit se safe
      socketTimeoutMS: 45000,
    })
    .then((conn) => {
      console.log("MongoDB Connected 🚀");
      return conn;
    })
    .catch((err) => {
      console.error("MongoDB Error:", err.message);
      cachedConnectionPromise = null; // next request pe retry ho sake
      throw err;
    });

  return cachedConnectionPromise;
}

// ── CASHFREE CLIENT ──────────────────────────────────────────────────────
const cashfree = new Cashfree(
  process.env.CASHFREE_ENV === "PRODUCTION" ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX,
  process.env.CASHFREE_CLIENT_ID,
  process.env.CASHFREE_CLIENT_SECRET
);

// ── CASHFREE WEBHOOK (must come BEFORE express.json()) ──────────────────
// Signature verification ke liye raw, unparsed body chahiye. Agar ye route
// express.json() ke baad hota to body object ban chuki hoti aur verify fail hota.
app.post("/api/payments/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  // 1) Signature verify — fail hua to 400 (ye request hi galat hai)
  let event;
  try {
    cashfree.PGVerifyWebhookSignature(
      req.headers["x-webhook-signature"],
      req.body,
      req.headers["x-webhook-timestamp"]
    );
    event = JSON.parse(req.body.toString());
  } catch (err) {
    console.error("Webhook verification failed:", err.message);
    return res.status(400).send("Invalid signature");
  }

  // 2) Processing — fail hua to 500, taaki Cashfree webhook dobara bheje
  try {
    await connectToDatabase(); // cold start pe buffering timeout se bachne ke liye

    console.log("Verified webhook:", event.type, event.data?.order?.order_id);

    const order = event.data?.order;
    const payment = event.data?.payment;

    // Sirf successful payment pe hi subscription credit karo
    if (event.type === "PAYMENT_SUCCESS_WEBHOOK" && order && payment?.payment_status === "SUCCESS") {
      const PLAN_ID_MAP = { starter: "free", pro: "pro", enterprise: "premium" };
      const [shopId, planId, cycle] = (order.order_note || "").split("|");
      const mappedPlan = PLAN_ID_MAP[planId];

      if (shopId && mappedPlan) {
        // Idempotency — same order dobara process na ho
        const alreadyRecorded = await Shop.exists({
          shopId,
          "subscription.renewalHistory.orderId": order.order_id,
        });

        if (!alreadyRecorded) {
          // expiry: abhi plan chal raha hai to bache hue din bhi jod do
          const existing = await Shop.findOne({ shopId }).select("subscription.expiresAt");
          const prevExpiry = existing?.subscription?.expiresAt;
          const base = prevExpiry && prevExpiry > new Date() ? prevExpiry : new Date();
          const expiresAt = new Date(base.getTime() + (cycle === "yearly" ? 365 : 30) * 86400000);

          await Shop.findOneAndUpdate(
            { shopId },
            {
              $set: {
                "subscription.plan": mappedPlan,
                "subscription.monthlyAmount": cycle === "yearly"
                  ? Math.round(order.order_amount / 12)
                  : order.order_amount,
                "subscription.expiresAt": expiresAt,
              },
              $push: {
                "subscription.renewalHistory": {
                  date: new Date(),
                  amount: order.order_amount,
                  plan: mappedPlan,
                  orderId: order.order_id,
                  method: (payment.payment_group || "").replace(/_/g, " ").toUpperCase(),
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
    console.error("Webhook processing failed:", err.message);
    res.status(500).send("Webhook processing failed");
  }
});

// limit 5mb — shop verification photos base64 mein aati hain (default 100kb se 413 aata)
app.use(express.json({ limit: "5mb" }));

// /api ke har request se pehle DB connection ensure karo —
// OPTIONS (CORS preflight) ko chhodkar, wo DB touch nahi karta aur turant
// return hona chahiye.
app.use("/api", async (req, res, next) => {
  if (req.method === "OPTIONS") return next();
  if (!process.env.MONGO_URI) return next(); // in-memory mode
  try {
    await connectToDatabase();
    next();
  } catch (err) {
    res.status(503).json({ error: "Database connection failed, please retry" });
  }
});

// Cold start pe bhi initial connection attempt (non-blocking)
connectToDatabase().catch(() => {});

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

// ── SUPER ADMIN: security router (db-status, sessions, alerts, audit) ──
// superAdminRouter se PEHLE mount hona zaroori hai.
if (typeof requireSuperAdmin === "function") {
  app.use("/api/sa-x7k9q2/security", saSecurityRouterFactory(requireSuperAdmin));
} else {
  console.warn("⚠️ requireSuperAdmin export nahi mila — super-admin security routes mount nahi hue (routes/superadmin.js me export add karo)");
}
app.use("/api/sa-x7k9q2", superAdminRouter);

app.use("/api/tasks", tasksRouter);
app.use("/api/restock-orders", restockOrdersRouter);
app.use("/api/payments", paymentsRouter); // Cashfree create-order/order-status
app.use("/api/customer-reports", customerReportsRouter); // shop owner/staff report submit
app.use("/api/shop-verification", shopVerificationRouter);

// ── ERROR HANDLING ────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Error:", err.message);
  // body-parser ki size error ko sahi status ke saath return karo
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Photos too large, please upload smaller images" });
  }
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