const express = require("express");
const router = express.Router();
const OpenAI = require("openai");
const Order = require("../models/Order");
const Product = require("../models/Product");

// ── Groq (FREE, OpenAI-compatible) ───────────────────────────────────────
const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
  timeout: 15000, // fail fast instead of hanging the request if Groq is slow
});

// How many previous turns (user+assistant pairs) to keep for context.
// Keeping this small keeps latency and token cost low while still letting
// the AI handle natural follow-ups ("uska price kya hai" etc.)
const MAX_HISTORY_TURNS = 6;

// ── Smart analysis engine ──────────────────────────────────────────────
// Fixed: schema only has Completed/Pending/Cancelled — "Delivered" and
// "Processing" never existed, so those counts were always silently 0.
async function analyzeBusinessData() {
  const [orders, products] = await Promise.all([
    Order.find().sort({ date: -1 }).limit(1000).lean(),
    Product.find().sort({ stock: 1 }).lean(),
  ]);

  const total = orders.length;
  const completed = orders.filter((o) => o.status === "Completed").length;
  const pending = orders.filter((o) => o.status === "Pending").length;
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
    total, completed, pending, cancelled,
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
    return `💰 Total Revenue: ₹${d.totalRevenue.toLocaleString("en-IN")}\n\n🏆 Top Revenue Products:\n${topProducts.map(([name, rev], i) => `  ${i + 1}. ${name}: ₹${rev.toLocaleString("en-IN")} (${d.ordersByProduct[name]} orders)`).join("\n")}\n\n📦 Orders: ${d.total} total | ${d.completed} completed | ${d.pending} pending`;
  }

  if (msg.includes("order") || msg.includes("pending") || msg.includes("deliver")) {
    return `📦 Order Summary:\n\n  • Total: ${d.total}\n  • ✅ Completed: ${d.completed}\n  • ⏳ Pending: ${d.pending}\n  • ❌ Cancelled: ${d.cancelled}\n\n${d.pending > 10 ? `⚠️ ${d.pending} orders are still pending — follow up required!` : "✅ Pending orders are manageable."}`;
  }

  const urgentItems = [];
  if (d.outOfStock.length) urgentItems.push(`🚨 ${d.outOfStock.length} products out of stock`);
  if (d.lowStock.length) urgentItems.push(`⚠️ ${d.lowStock.length} products low on stock`);
  if (d.cancellationRate > 5) urgentItems.push(`❌ Cancellation rate ${d.cancellationRate}% — needs attention`);
  if (d.slowMoving.length) urgentItems.push(`💸 ${d.slowMoving.length} slow-moving products — consider running offers`);

  return `📊 Business Snapshot:\n\n  • Revenue: ₹${d.totalRevenue.toLocaleString("en-IN")}\n  • Orders: ${d.total} (${d.completed} completed)\n  • Cancellation Rate: ${d.cancellationRate}%\n\n${urgentItems.length ? `🔔 Action Items:\n${urgentItems.map((i) => `  ${i}`).join("\n")}` : "✅ Business is running smoothly!"}`;
}

// ── Build compact context for AI ──────────────────────────────────────────
// Capped list lengths so a shop with hundreds of low-stock/slow-moving
// products doesn't blow up the prompt size (slower + costs more tokens).
function buildContextSummary(d) {
  const topProducts = Object.entries(d.revenueByProduct)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, rev]) => `${name}: ₹${rev.toLocaleString("en-IN")} (${d.ordersByProduct[name] || 0} orders)`)
    .join(", ");

  const cap = (arr, n) => arr.slice(0, n);

  return `
Business Snapshot:
- Total Revenue: ₹${d.totalRevenue.toLocaleString("en-IN")}
- Orders: ${d.total} total | ${d.completed} completed | ${d.pending} pending | ${d.cancelled} cancelled
- Cancellation Rate: ${d.cancellationRate}%
- Out of Stock (${d.outOfStock.length}): ${cap(d.outOfStock, 15).map((p) => p.name).join(", ") || "None"}${d.outOfStock.length > 15 ? ", ..." : ""}
- Low Stock (${d.lowStock.length}): ${cap(d.lowStock, 15).map((p) => `${p.name} (${p.stock} left)`).join(", ") || "None"}${d.lowStock.length > 15 ? ", ..." : ""}
- Slow Moving (${d.slowMoving.length}): ${cap(d.slowMoving, 15).map((p) => p.name).join(", ") || "None"}${d.slowMoving.length > 15 ? ", ..." : ""}
- Fast Growing: ${d.fastGrowing.map((p) => `${p.name} (+${p.growthPercent}%)`).join(", ") || "None"}
- Top Revenue Products: ${topProducts || "N/A"}
`.trim();
}

// ── AI reply via Groq (FREE) ───────────────────────────────────────────────
// Now accepts `history` (array of { role, text }) so follow-up questions
// like "uska price kya hai" actually have context to resolve against.
async function getAIReply(userMsg, history, d) {
  const context = buildContextSummary(d);

  const trimmedHistory = (history || [])
    .slice(-MAX_HISTORY_TURNS * 2) // keep last N turns (user+assistant)
    .filter((m) => m && m.text && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({ role: m.role, content: m.text }));

  const completion = await openai.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 500,
    temperature: 0.5,
    messages: [
      {
        role: "system",
        content: `You are Alex, an AI assistant built into a shop's inventory and sales management app.

LANGUAGE RULE (critical): Detect the language of the user's CURRENT message only, and reply entirely in that same language.
- Pure English question → reply in pure English.
- Hindi or Hinglish question → reply in Hindi/Hinglish.
- Never default to Hindi just because these instructions are in English.

IDENTITY RULE: Only mention your name ("Alex") if the user directly asks who you are or what your name is. Do NOT introduce yourself or repeat your name in unrelated answers.

MEMORY RULE: You have access to the recent conversation history below. Use it to resolve follow-up questions and pronouns ("uska", "that one", "isme se") naturally — don't ask the user to repeat themselves if the answer is inferable from earlier turns.

CAPABILITY QUESTIONS: If the user asks things like "what is this app", "what do you do here", "what can you help with" — explain naturally in your own words that you're an AI assistant for this shop that can answer questions about stock, orders, revenue, cancellations, and give business suggestions based on real data. Don't use a fixed script — vary your wording naturally.

BUSINESS ADVICE: If the user asks how to grow sales, improve revenue, or wants promotion/marketing ideas, give specific, actionable suggestions using the REAL data below — mention actual product names, numbers, and reasoning (e.g. "X hai slow-moving with only 2 orders, ek 15% discount ya bundle deal try karo", "Y stock khatam hone wala hai but demand high hai, urgently restock karo"). Be a genuinely helpful business advisor, not just a data reader.

DATA RULE: Base all factual answers strictly on the real data below. Never invent numbers or products that aren't listed. If something isn't in the data, say so instead of guessing.

Keep replies concise, practical, and to the point (2-5 sentences unless the user explicitly asks for a detailed breakdown).

${context}`,
      },
      ...trimmedHistory,
      { role: "user", content: userMsg },
    ],
  });

  return completion.choices[0].message.content;
}

// ── POST /api/chat ────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const { message, history } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: "message required" });
  }

  try {
    const data = await analyzeBusinessData();
    let reply;
    let usedFallback = false;

    try {
      reply = await getAIReply(message, history, data);
    } catch (aiErr) {
      usedFallback = true;
      console.error("AI error →", {
        status: aiErr.status,
        code: aiErr.code,
        message: aiErr.message,
      });
      reply = generateReply(message, data);
    }

    res.json({ reply, usedFallback });
  } catch (err) {
    console.error("Chat error:", err.message);
    res.status(500).json({ error: "Analysis failed" });
  }
});

module.exports = router;