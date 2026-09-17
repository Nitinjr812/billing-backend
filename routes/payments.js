// ── routes/payments.js ──────────────────────────────────────────────────
const express = require("express");
const { Cashfree, CFEnvironment } = require("cashfree-pg");
const { verifyToken } = require("../middleware/auth");
const User = require("../models/User");
const Shop = require("../models/Shop");

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
// ke PLANS array se EXACTLY match hone chahiye — dono jagah number badlo
// ek saath, warna frontend kuch dikhayega aur backend kuch aur charge karega.
const PRICING = {
  starter:    { monthly: 499,  yearly: 399 },
  pro:        { monthly: 1299, yearly: 999 },
  enterprise: { monthly: 2999, yearly: 2399 },
};

router.use(verifyToken); // ── payment sirf logged-in shop hi start kar sakti hai ──

// ── Shared helper: given a Cashfree order object, if it's PAID, upsert
// Shop.subscription. Used by BOTH the webhook (server.js) conceptually
// and this order-status fallback, so whichever fires first (or both)
// gets the shop into the right state. Idempotent via renewalHistory.orderId
// check, so double-crediting can't happen even if webhook + fallback
// both run for the same order. ─────────────────────────────────────────
async function creditOrderIfPaid(order) {
  if (!order || order.order_status !== "PAID") return null;

  const [shopId, planId, cycle] = (order.order_note || "").split("|");
  const mappedPlan = PLAN_ID_MAP[planId];

  if (!shopId || !mappedPlan) {
    console.warn("order-status: order_note missing/invalid shopId or plan:", order.order_note);
    return null;
  }

  const alreadyRecorded = await Shop.exists({
    shopId,
    "subscription.renewalHistory.orderId": order.order_id,
  });

  if (alreadyRecorded) {
    return { updated: false, reason: "already-recorded" };
  }

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

  console.log(`✅ [order-status fallback] Subscription updated for ${shopId}: ${mappedPlan} (₹${order.order_amount})`);
  return { updated: true };
}

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

    // Webhook (aur order-status fallback) isi note ko split karke
    // shopId/plan/cycle nikalte hain
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

// ── Check order status + fallback DB update ───────────────────────────
// GET /api/payments/order-status/:orderId
//
// This used to ONLY fetch status from Cashfree and return it — it never
// wrote to the DB. That meant Shop.subscription was updated ONLY by the
// webhook (server.js). Locally, or if the webhook URL isn't reachable
// from Cashfree's servers, the webhook never fires, so the plan never
// actually changes even after a successful payment. This route now also
// credits the subscription itself (idempotently) as a fallback, so the
// plan updates correctly whether or not the webhook lands.
router.get("/order-status/:orderId", async (req, res) => {
  try {
    const response = await cashfree.PGFetchOrder(req.params.orderId);
    const order = response.data;

    try {
      await creditOrderIfPaid(order);
    } catch (creditErr) {
      // Never fail the whole request just because the fallback credit
      // step had an issue — the webhook may still land separately.
      console.error("order-status fallback credit failed:", creditErr.message);
    }

    res.json(order);
  } catch (err) {
    console.error("Cashfree fetch order failed:", err.response?.data || err.message);
    res.status(500).json({ error: "Could not fetch order status" });
  }
});

module.exports = router;