const express = require("express");
const router = express.Router();
const OpenAI = require("openai");
const Order = require("../models/Order");
const Product = require("../models/Product");

// ── Groq (FREE, OpenAI-compatible) ───────────────────────────────────────
const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

// ── Smart analysis engine (UNCHANGED) ─────────────────────────────────────
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

// ── OLD keyword-based reply (fallback, jab Groq bhi fail ho) ─────────────
function generateReply(userMsg, d) {
  const msg = userMsg.toLowerCase();

  if (msg.includes("restock") || msg.includes("stock") || msg.includes("inventory")) {
    const lines = [];
    if (d.outOfStock.length) {
      lines.push(`🚨 Out of Stock — Order immediately:\n${d.outOfStock.map((p) => `  • ${p.name} (₹${p.price?.toLocaleString("en-IN")})`).join("\n")}`);
    }
    if (d.lowStock.length) {
      lines.push(`⚠️ Low Stock — Restock soon:\n${d.lowStock.map((p) => `  • ${p.name}: only ${p.stock} units remaining`).join("\n")}`);
    }
    const urgentFast = d.fastGrowing.filter((p) => p.stock < 100);
    if (urgentFast.length) {
      lines.push(`📈 Fast growing + low stock — Priority restock:\n${urgentFast.map((p) => `  • ${p.name}: +${p.growthPercent}% growth, ${p.stock} units left`).join("\n")}`);
    }
    if (!lines.length) lines.push("✅ All products are well stocked. No restocking needed right now.");
    return lines.join("\n\n");
  }

  if (msg.includes("offer") || msg.includes("discount") || msg.includes("sale") || msg.includes("slow")) {
    const lines = [];
    if (d.slowMoving.length) {
      lines.push(`💸 Slow-moving products — Consider running offers:\n${d.slowMoving.map((p) => {
        const rev = d.revenueByProduct[p.name] || 0;
        const discount = p.price > 2000 ? "15%" : "10%";
        return `  • ${p.name}: only ${d.ordersByProduct[p.name] || 0} orders, ₹${rev.toLocaleString("en-IN")} revenue → suggest ${discount} discount`;
      }).join("\n")}`);
    }
    if (d.outOfStock.length) {
      lines.push(`🎯 Run a flash sale on these after restocking:\n${d.outOfStock.map((p) => `  • ${p.name} — high demand expected`).join("\n")}`);
    }
    const topProduct = Object.entries(d.revenueByProduct).sort((a, b) => b[1] - a[1])[0];
    if (topProduct) {
      lines.push(`🏆 Top seller "${topProduct[0]}" — try a bundle deal to boost revenue further. Current revenue: ₹${topProduct[1].toLocaleString("en-IN")}.`);
    }
    if (!lines.length) lines.push("📊 All products are performing well. No special offers needed at this time.");
    return lines.join("\n\n");
  }

  if (msg.includes("cancel") || msg.includes("cancellation")) {
    const lines = [];
    lines.push(`🚫 Cancellation Rate: ${d.cancellationRate}%`);
    if (d.cancellationRate > 10) {
      lines.push(`❌ Cancellation rate is very high! ${d.cancelled} orders cancelled.\nPlease check: delivery delays, payment issues, or product quality.`);
    } else if (d.cancellationRate > 5) {
      lines.push(`⚠️ Cancellation rate is slightly high. ${d.cancelled} orders cancelled.\nSuggestion: Send order confirmation SMS/email and provide estimated delivery time.`);
    } else {
      lines.push(`✅ Cancellation rate is within normal range. ${d.cancelled} orders cancelled.`);
    }
    return lines.join("\n\n");
  }

  if (msg.includes("revenue") || msg.includes("earning") || msg.includes("income") || msg.includes("sales")) {
    const topProducts = Object.entries(d.revenueByProduct).sort((a, b) => b[1] - a[1]).slice(0, 3);
    return `💰 Total Revenue: ₹${d.totalRevenue.toLocaleString("en-IN")}\n\n🏆 Top Revenue Products:\n${topProducts.map(([name, rev], i) => `  ${i + 1}. ${name}: ₹${rev.toLocaleString("en-IN")} (${d.ordersByProduct[name]} orders)`).join("\n")}\n\n📦 Orders: ${d.total} total | ${d.delivered} delivered | ${d.pending} pending`;
  }

  if (msg.includes("order") || msg.includes("pending") || msg.includes("deliver")) {
    return `📦 Order Summary:\n\n  • Total: ${d.total}\n  • ✅ Delivered: ${d.delivered}\n  • ⏳ Pending: ${d.pending}\n  • 🔄 Processing: ${d.processing}\n  • ❌ Cancelled: ${d.cancelled}\n\n${d.pending > 10 ? `⚠️ ${d.pending} orders are still pending — follow up required!` : "✅ Pending orders are manageable."}`;
  }

  const urgentItems = [];
  if (d.outOfStock.length) urgentItems.push(`🚨 ${d.outOfStock.length} products out of stock`);
  if (d.lowStock.length) urgentItems.push(`⚠️ ${d.lowStock.length} products low on stock`);
  if (d.cancellationRate > 5) urgentItems.push(`❌ Cancellation rate ${d.cancellationRate}% — needs attention`);
  if (d.slowMoving.length) urgentItems.push(`💸 ${d.slowMoving.length} slow-moving products — consider running offers`);

  return `📊 Business Snapshot:\n\n  • Revenue: ₹${d.totalRevenue.toLocaleString("en-IN")}\n  • Orders: ${d.total} (${d.delivered} delivered)\n  • Cancellation Rate: ${d.cancellationRate}%\n\n${urgentItems.length ? `🔔 Action Items:\n${urgentItems.map((i) => `  ${i}`).join("\n")}` : "✅ Business is running smoothly!"}`;
}

// ── Build compact context for AI ──────────────────────────────────────────
function buildContextSummary(d) {
  const topProducts = Object.entries(d.revenueByProduct)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, rev]) => `${name}: ₹${rev.toLocaleString("en-IN")} (${d.ordersByProduct[name] || 0} orders)`)
    .join(", ");

  return `
Business Snapshot:
- Total Revenue: ₹${d.totalRevenue.toLocaleString("en-IN")}
- Orders: ${d.total} total | ${d.delivered} delivered | ${d.pending} pending | ${d.processing} processing | ${d.cancelled} cancelled
- Cancellation Rate: ${d.cancellationRate}%
- Out of Stock: ${d.outOfStock.map((p) => p.name).join(", ") || "None"}
- Low Stock: ${d.lowStock.map((p) => `${p.name} (${p.stock} left)`).join(", ") || "None"}
- Slow Moving: ${d.slowMoving.map((p) => p.name).join(", ") || "None"}
- Fast Growing: ${d.fastGrowing.map((p) => `${p.name} (+${p.growthPercent}%)`).join(", ") || "None"}
- Top Revenue Products: ${topProducts || "N/A"}
`.trim();
}

// ── AI reply via Groq (FREE) ───────────────────────────────────────────────
async function getAIReply(userMsg, d) {
  const context = buildContextSummary(d);

  const completion = await openai.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: `Tum ek inventory & sales assistant ho ek shop ke liye. Neeche di gayi REAL business data ke aadhar par hi jawab do — kabhi data bina apni taraf se number mat banao. Jawab short, practical aur actionable ho. Agar user Hindi/Hinglish me poochta hai to usi tarah reply karo.\n\n${context}`,
      },
      { role: "user", content: userMsg },
    ],
    temperature: 0.4,
  });

  return completion.choices[0].message.content;
}

// ── POST /api/chat ────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "message required" });

  try {
    const data = await analyzeBusinessData();
    let reply;
    let usedFallback = false;

    try {
      reply = await getAIReply(message, data);
    } catch (aiErr) {
      usedFallback = true;
      // ── DETAILED LOGGING — isse Vercel logs me exact wajah dikhegi ──
      console.error("AI error →", {
        status: aiErr.status,
        code: aiErr.code,
        message: aiErr.message,
      });
      reply = generateReply(message, data);
    }

    res.json({ reply, usedFallback }); // usedFallback frontend me bhi dikh sakta hai debug ke liye
  } catch (err) {
    console.error("Chat error:", err.message);
    res.status(500).json({ error: "Analysis failed" });
  }
});

module.exports = router;