const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const Product = require("../models/Product");

// ── Smart analysis engine ─────────────────────────────────────────────────────
async function analyzeBusinessData() {
  const [orders, products] = await Promise.all([
    Order.find().sort({ date: -1 }),
    Product.find().sort({ stock: 1 }),
  ]);

  const total = orders.length;
  const delivered = orders.filter((o) => o.status === "Delivered").length;
  const pending = orders.filter((o) => o.status === "Pending").length;
  const processing = orders.filter((o) => o.status === "Processing").length;
  const cancelled = orders.filter((o) => o.status === "Cancelled").length;
  const cancellationRate = total ? ((cancelled / total) * 100).toFixed(1) : 0;

  const totalRevenue = orders
    .filter((o) => o.status !== "Cancelled")
    .reduce((sum, o) => sum + o.amount, 0);

  const revenueByProduct = {};
  const ordersByProduct = {};
  for (const o of orders) {
    if (o.status !== "Cancelled") {
      revenueByProduct[o.product] = (revenueByProduct[o.product] || 0) + o.amount;
      ordersByProduct[o.product] = (ordersByProduct[o.product] || 0) + 1;
    }
  }

  const lowStock = products.filter((p) => p.stock > 0 && p.stock < 50);
  const outOfStock = products.filter((p) => p.stock === 0);
  const slowMoving = products.filter((p) => (ordersByProduct[p.name] || 0) < 2);
  const fastGrowing = products.filter((p) => p.growthPercent >= 15);

  return {
    orders, products,
    total, delivered, pending, processing, cancelled,
    cancellationRate, totalRevenue,
    revenueByProduct, ordersByProduct,
    lowStock, outOfStock, slowMoving, fastGrowing,
  };
}

// ── Generate smart reply based on user message ────────────────────────────────
function generateReply(userMsg, d) {
  const msg = userMsg.toLowerCase();

  // ── RESTOCK ──
  if (msg.includes("restock") || msg.includes("stock") || msg.includes("inventory")) {
    const lines = [];

    if (d.outOfStock.length) {
      lines.push(`🚨 Out of Stock — Turant order karo:\n${d.outOfStock.map((p) => `  • ${p.name} (₹${p.price?.toLocaleString("en-IN")})`).join("\n")}`);
    }

    if (d.lowStock.length) {
      lines.push(`⚠️ Low Stock — Jaldi restock karo:\n${d.lowStock.map((p) => `  • ${p.name}: sirf ${p.stock} units bacha hai`).join("\n")}`);
    }

    const urgentFast = d.fastGrowing.filter((p) => p.stock < 100);
    if (urgentFast.length) {
      lines.push(`📈 Fast growing + low stock — Priority restock:\n${urgentFast.map((p) => `  • ${p.name}: +${p.growthPercent}% growth, ${p.stock} units`).join("\n")}`);
    }

    if (!lines.length) lines.push("✅ Sab products ka stock theek hai, abhi restock ki zarurat nahi.");
    return lines.join("\n\n");
  }

  // ── OFFERS / DISCOUNTS ──
  if (msg.includes("offer") || msg.includes("discount") || msg.includes("sale") || msg.includes("slow")) {
    const lines = [];

    if (d.slowMoving.length) {
      lines.push(`💸 Slow-moving products — Offer lagao:\n${d.slowMoving.map((p) => {
        const rev = d.revenueByProduct[p.name] || 0;
        const discount = p.price > 2000 ? "15%" : "10%";
        return `  • ${p.name}: sirf ${d.ordersByProduct[p.name] || 0} orders, ₹${rev.toLocaleString("en-IN")} revenue → ${discount} discount suggest`;
      }).join("\n")}`);
    }

    if (d.outOfStock.length) {
      lines.push(`🎯 Out-of-stock products pe restock ke baad flash sale chalaao:\n${d.outOfStock.map((p) => `  • ${p.name} — demand high ho sakti hai`).join("\n")}`);
    }

    const topProduct = Object.entries(d.revenueByProduct).sort((a, b) => b[1] - a[1])[0];
    if (topProduct) {
      lines.push(`🏆 Top seller "${topProduct[0]}" pe bundle deal try karo — ₹${topProduct[1].toLocaleString("en-IN")} revenue hai, combo offer se aur badh sakta hai.`);
    }

    if (!lines.length) lines.push("📊 Sab products theek chal rahe hain, abhi koi special offer ki zarurat nahi.");
    return lines.join("\n\n");
  }

  // ── CANCELLATIONS ──
  if (msg.includes("cancel") || msg.includes("cancellation")) {
    const lines = [];
    lines.push(`🚫 Cancellation Rate: ${d.cancellationRate}%`);

    if (d.cancellationRate > 10) {
      lines.push(`❌ Bahut zyada cancellations hain! ${d.cancelled} orders cancel hue.\nCheck karo: delivery delay, payment issues, ya product quality.`);
    } else if (d.cancellationRate > 5) {
      lines.push(`⚠️ Cancellation thoda zyada hai. ${d.cancelled} orders cancel.\nSuggestion: customers ko order confirm SMS/email bhejo aur estimated delivery time do.`);
    } else {
      lines.push(`✅ Cancellation rate normal range mein hai. ${d.cancelled} orders cancel hue.`);
    }

    return lines.join("\n\n");
  }

  // ── REVENUE ──
  if (msg.includes("revenue") || msg.includes("paisa") || msg.includes("kamai") || msg.includes("income")) {
    const topProducts = Object.entries(d.revenueByProduct)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    return `💰 Total Revenue: ₹${d.totalRevenue.toLocaleString("en-IN")}\n\n🏆 Top Revenue Products:\n${topProducts.map(([name, rev], i) => `  ${i + 1}. ${name}: ₹${rev.toLocaleString("en-IN")} (${d.ordersByProduct[name]} orders)`).join("\n")}\n\n📦 Orders: ${d.total} total | ${d.delivered} delivered | ${d.pending} pending`;
  }

  // ── ORDERS ──
  if (msg.includes("order") || msg.includes("pending") || msg.includes("deliver")) {
    return `📦 Order Summary:\n\n  • Total: ${d.total}\n  • ✅ Delivered: ${d.delivered}\n  • ⏳ Pending: ${d.pending}\n  • 🔄 Processing: ${d.processing}\n  • ❌ Cancelled: ${d.cancelled}\n\n${d.pending > 10 ? `⚠️ ${d.pending} orders abhi bhi pending hain — follow up karo!` : "✅ Pending orders manageable hain."}`;
  }

  // ── SUMMARY / DEFAULT ──
  const urgentItems = [];
  if (d.outOfStock.length) urgentItems.push(`🚨 ${d.outOfStock.length} products out of stock`);
  if (d.lowStock.length) urgentItems.push(`⚠️ ${d.lowStock.length} products low stock`);
  if (d.cancellationRate > 5) urgentItems.push(`❌ Cancellation rate ${d.cancellationRate}% — high hai`);
  if (d.slowMoving.length) urgentItems.push(`💸 ${d.slowMoving.length} slow-moving products — offer lagao`);

  return `📊 Business Snapshot:\n\n  • Revenue: ₹${d.totalRevenue.toLocaleString("en-IN")}\n  • Orders: ${d.total} (${d.delivered} delivered)\n  • Cancellation Rate: ${d.cancellationRate}%\n\n${urgentItems.length ? `🔔 Action Items:\n${urgentItems.map((i) => `  ${i}`).join("\n")}` : "✅ Business smooth chal raha hai!"}`;
}

// ── POST /api/chat ─────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: "message required" });
  }

  try {
    const data = await analyzeBusinessData();
    const reply = generateReply(message, data);
    res.json({ reply });
  } catch (err) {
    console.error("Chat error:", err.message);
    res.status(500).json({ error: "Analysis failed" });
  }
});

module.exports = router;