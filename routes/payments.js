// ── routes/payments.js ──────────────────────────────────────────────────
// Cashfree Payment Gateway routes.
// NOTE: the webhook route is NOT here — it needs the raw request body for
// signature verification, and your server.js already applies
// express.json() globally before routers are mounted. See the server.js
// snippet in the setup notes for where the webhook route goes instead.

const express = require("express");
const { Cashfree, CFEnvironment } = require("cashfree-pg");

const router = express.Router();

const cashfree = new Cashfree(
  process.env.CASHFREE_ENV === "PRODUCTION" ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX,
  process.env.CASHFREE_CLIENT_ID,
  process.env.CASHFREE_CLIENT_SECRET
);

// ── Create order ──────────────────────────────────────────────────────
// POST /api/payments/create-order
router.post("/create-order", async (req, res) => {
  const { amount, currency, customerId, phone, email, note, shopId } = req.body;

  if (!amount || !customerId) {
    return res.status(400).json({ error: "amount and customerId are required" });
  }

  const orderId = `order_${shopId || "shop"}_${Date.now()}`;

  try {
    const response = await cashfree.PGCreateOrder({
      order_id: orderId,
      order_amount: amount,
      order_currency: currency || "INR",
      customer_details: {
        customer_id: customerId,
        customer_phone: phone || "9999999999",
        customer_email: email || "test@example.com",
      },
      order_meta: {
        return_url: `${process.env.FRONTEND_URL}/order-status?order_id={order_id}`,
        notify_url: `${process.env.BACKEND_URL}/api/payments/webhook`,
      },
      order_note: note || "",
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