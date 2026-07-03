const express = require("express");
const router = express.Router();
const OpenAI = require("openai");
const Order = require("../models/Order");
const Product = require("../models/Product");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Smart analysis engine (UNCHANGED — same as before) ──────────────────
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

// ── OLD keyword-based reply (KEPT as fallback only) ──────────────────────
function generateReply(userMsg, d) {
  // ...tumhara purana wala code yahan waise hi rehne do (copy-paste kar dena)
  // isse touch nahi karna, bas fallback ke liye use hoga
}

// ── Build a compact context summary for GPT (avoid sending raw arrays) ───
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

// ── Real ChatGPT reply, grounded in real inventory/order data ────────────
async function getAIReply(userMsg, d) {
  const context = buildContextSummary(d);

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini", // sasta aur fast, chahe toh gpt-4o bhi use kar sakte ho
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
    try {
      reply = await getAIReply(message, data);
    } catch (aiErr) {
      console.error("OpenAI error, falling back to rule-based:", aiErr.message);
      reply = generateReply(message, data); // OpenAI down ho toh bhi chatbot chalega
    }
    res.json({ reply });
  } catch (err) {
    console.error("Chat error:", err.message);
    res.status(500).json({ error: "Analysis failed" });
  }
});

module.exports = router;