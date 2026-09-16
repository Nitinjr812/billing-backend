// ── routes/payments.js ──────────────────────────────────────────────────
const express = require("express");
const { Cashfree, CFEnvironment } = require("cashfree-pg");
const { verifyToken } = require("../middleware/auth");
const User = require("../models/User");

const router = express.Router();

const cashfree = new Cashfree(
  process.env.CASHFREE_ENV === "PRODUCTION" ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX,
  process.env.CASHFREE_CLIENT_ID,
  process.env.CASHFREE_CLIENT_SECRET
);

// Frontend ke plan ids (Subscription.jsx PLANS array) → Shop.subscription.plan enum
const PLAN_ID_MAP = { starter: "free", pro: "pro", enterprise: "premium" };

// ── Server-side pricing — kabhi bhi client se bheja hua "amount" trust
// mat karo, warna koi bhi ₹1 bhejke premium le sakta hai. Yeh Subscription.jsx
// ke PLANS array se match hone chahiye. ─────────────────────────────────
const PRICING = {
  starter:    { monthly: 1,    yearly: 399 },
  pro:        { monthly: 1299, yearly: 999 },
  enterprise: { monthly: 2999, yearly: 2399 },
};

router.use(verifyToken); // ── payment sirf logged-in shop hi start kar sakti hai ──

// ── Create order ──────────────────────────────────────────────────────
// POST /api/payments/create-order   body: { planId, billing }
router.post("/create-order", async (req, res) => {
  const { planId, billing } = req.body;
  const { shopId, userId } = req.user;

  if (!planId || !PRICING[planId]) {
    return res.status(400).json({ error: "Invalid or missing planId" });
  }

  const cycle = billing === "yearly" ? "yearly" : "monthly";
  const amount = PRICING[planId][cycle];

  try {
    const user = await User.findById(userId).select("name email phone");
    const orderId = `order_${shopId}_${Date.now()}`;

    // Webhook isi note ko split karke shopId/plan/cycle nikalega
    const orderNote = `${shopId}|${planId}|${cycle}`;

    const response = await cashfree.PGCreateOrder({
      order_id: orderId,
      order_amount: amount,
      order_currency: "INR",
      customer_details: {
        customer_id: userId.toString(),
        customer_phone: user?.phone || "9999999999",
        customer_email: user?.email || "test@example.com",
      },
      order_meta: {
        return_url: `${process.env.FRONTEND_URL}/subscription?order_id={order_id}`,
        notify_url: `${process.env.BACKEND_URL}/api/payments/webhook`,
      },
      order_note: orderNote,
    });

    res.json({
      payment_session_id: response.data.payment_session_id,
      order_id: response.data.order_id,
    });
  } catch (err) {
    console.error("Cashfree create order failed:", err.response?.data || err.message);
    res.status(500).json({ error: "Order creation failed" });
  }
});

// ── Check order status ────────────────────────────────────────────────
// GET /api/payments/order-status/:orderId
router.get("/order-status/:orderId", async (req, res) => {
  try {
    const response = await cashfree.PGFetchOrder(req.params.orderId);
    res.json(response.data);
  } catch (err) {
    console.error("Cashfree fetch order failed:", err.response?.data || err.message);
    res.status(500).json({ error: "Could not fetch order status" });
  }
});

module.exports = router;