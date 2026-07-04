const express = require("express");
const router = express.Router();
const OpenAI = require("openai");
const Order = require("../models/Order");
const Product = require("../models/Product");

const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

// ── Smart analysis engine ─────────────────────────────────────────────────
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

  const revenueByMonth = {};
  const ordersByMonth = {};
  for (const o of orders) {
    if (o.status !== "Cancelled") {
      const month = new Date(o.date).toLocaleString("en-IN", { month: "short", year: "numeric" });
      revenueByMonth[month] = (revenueByMonth[month] || 0) + o.amount;
      ordersByMonth[month] = (ordersByMonth[month] || 0) + 1;
    }
  }

  return {
    total, delivered, pending, processing, cancelled,
    cancellationRate, totalRevenue,
    revenueByProduct, ordersByProduct,
    lowStock, outOfStock, slowMoving, fastGrowing,
    revenueByMonth, ordersByMonth,
  };
}

// ── Fallback (rule-based) ──────────────────────────────────────────────────
function generateReply(userMsg, d) {
  const msg = userMsg.toLowerCase();

  if (msg.includes("trend") || msg.includes("revenue")) {
    const months = Object.entries(d.revenueByMonth);
    return `📈 Revenue Trend:\n${months.map(([m, v]) => `  • ${m}: ₹${v.toLocaleString("en-IN")}`).join("\n")}\n\n💰 Total: ₹${d.totalRevenue.toLocaleString("en-IN")}`;
  }
  if (msg.includes("top") || msg.includes("product")) {
    const top = Object.entries(d.revenueByProduct).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return `🏆 Top Products:\n${top.map(([name, rev], i) => `  ${i + 1}. ${name}: ₹${rev.toLocaleString("en-IN")}`).join("\n")}`;
  }
  if (msg.includes("stock")) {
    return `📦 Stock Alerts:\nOut of Stock: ${d.outOfStock.map((p) => p.name).join(", ") || "None"}\nLow Stock: ${d.lowStock.map((p) => `${p.name} (${p.stock})`).join(", ") || "None"}`;
  }
  if (msg.includes("cancel")) {
    return `🚫 Cancellation Rate: ${d.cancellationRate}% (${d.cancelled} of ${d.total} orders)`;
  }
  if (msg.includes("offer")) {
    return `💸 Offer Ideas:\n${d.slowMoving.map((p) => `  • Discount on ${p.name} (slow moving)`).join("\n") || "No slow-moving products right now."}`;
  }
  return `📊 Summary: ₹${d.totalRevenue.toLocaleString("en-IN")} revenue, ${d.total} orders, ${d.cancellationRate}% cancellation rate.`;
}

function buildContextSummary(d) {
  const topProducts = Object.entries(d.revenueByProduct)
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([name, rev]) => `${name}: ₹${rev.toLocaleString("en-IN")} (${d.ordersByProduct[name] || 0} orders)`)
    .join(", ");

  const monthlyRevenue = Object.entries(d.revenueByMonth)
    .map(([m, v]) => `${m}: ₹${v.toLocaleString("en-IN")}`)
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
- Monthly Revenue: ${monthlyRevenue || "N/A"}
`.trim();
}

async function getAIReply(userMsg, d) {
  const context = buildContextSummary(d);

  const completion = await openai.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      {
        role: "system",
        content: `You are Alex, an AI Reports Analyst built into a shop's business dashboard.

LANGUAGE RULE (critical): Detect the language of the user's CURRENT message only, and reply entirely in that same language.
- Pure English question → reply in pure English.
- Hindi or Hinglish question → reply in Hindi/Hinglish.
- Never default to Hindi just because these instructions are in English.

IDENTITY RULE: Only mention your name ("Alex") if the user directly asks who you are. Do NOT repeat your name in unrelated answers.

CAPABILITY QUESTIONS: If asked what you do or what this app does, explain naturally that you analyze the shop's revenue trends, top products, stock alerts, and order data, and can suggest business improvements — vary your wording, don't use a fixed script.

BUSINESS ADVICE: If asked how to grow sales or for promotion ideas, give specific actionable suggestions using the REAL data below — real product names, numbers, and clear reasoning.

DATA RULE: Base all factual answers strictly on the real data below. Never invent numbers.

Keep replies concise and practical.

${context}`,
      },
      { role: "user", content: userMsg },
    ],
    temperature: 0.5,
  });

  return completion.choices[0].message.content;
}

router.post("/", async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "message required" });

  try {
    const data = await analyzeBusinessData();
    let reply;
    try {
      reply = await getAIReply(message, data);
    } catch (aiErr) {
      console.error("AI error →", { status: aiErr.status, message: aiErr.message });
      reply = generateReply(message, data);
    }
    res.json({ reply });
  } catch (err) {
    console.error("Report-chat error:", err.message);
    res.status(500).json({ error: "Analysis failed" });
  }
});

module.exports = router;