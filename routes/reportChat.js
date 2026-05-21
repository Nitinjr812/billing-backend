const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const Product = require("../models/Product");

async function getReportData() {
  const [orders, products] = await Promise.all([
    Order.find().sort({ date: -1 }),
    Product.find(),
  ]);

  const total      = orders.length;
  const delivered  = orders.filter((o) => o.status === "Delivered").length;
  const pending    = orders.filter((o) => o.status === "Pending").length;
  const processing = orders.filter((o) => o.status === "Processing").length;
  const cancelled  = orders.filter((o) => o.status === "Cancelled").length;
  const cancellationRate = total ? +((cancelled / total) * 100).toFixed(1) : 0;

  const totalRevenue  = orders.filter((o) => o.status !== "Cancelled").reduce((s, o) => s + o.amount, 0);
  const avgOrderValue = total ? Math.round(totalRevenue / (total - cancelled || 1)) : 0;

  const revenueByProduct  = {};
  const ordersByProduct   = {};
  const revenueByCategory = {};
  const revenueByMonth    = {};
  const ordersByMonth     = {};

  const productMap = {};
  for (const p of products) productMap[p.name] = p;

  for (const o of orders) {
    const month = new Date(o.date).toLocaleString("en-IN", { month: "short" });
    ordersByMonth[month] = (ordersByMonth[month] || 0) + 1;
    if (o.status !== "Cancelled") {
      revenueByProduct[o.product]  = (revenueByProduct[o.product]  || 0) + o.amount;
      ordersByProduct[o.product]   = (ordersByProduct[o.product]   || 0) + 1;
      revenueByMonth[month]        = (revenueByMonth[month]        || 0) + o.amount;
      const cat = productMap[o.product]?.category || "Other";
      revenueByCategory[cat] = (revenueByCategory[cat] || 0) + o.amount;
    }
  }

  const topProducts = Object.entries(revenueByProduct)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, rev]) => ({
      name, revenue: rev,
      orders: ordersByProduct[name] || 0,
      growth: productMap[name]?.growthPercent || 0,
      category: productMap[name]?.category || "—",
    }));

  const lowStock   = products.filter((p) => p.stock > 0 && p.stock < 50);
  const outOfStock = products.filter((p) => p.stock === 0);
  const fastGrowing = products.filter((p) => p.growthPercent >= 15);
  const slowMoving  = products.filter((p) => (ordersByProduct[p.name] || 0) < 2);

  return {
    total, delivered, pending, processing, cancelled,
    cancellationRate, totalRevenue, avgOrderValue,
    revenueByProduct, ordersByProduct,
    revenueByCategory, revenueByMonth, ordersByMonth,
    topProducts, lowStock, outOfStock, fastGrowing, slowMoving, products,
  };
}

function generateReportReply(msg, d) {
  const q = msg.toLowerCase();

  // ── REVENUE ──
  if (q.includes("revenue") || q.includes("earning") || q.includes("income") || q.includes("sales") || q.includes("trend")) {
    const months = Object.entries(d.revenueByMonth).slice(-6);
    const trend  = months.map(([m, v]) => `${m}: ₹${v.toLocaleString("en-IN")}`).join(" → ");
    const top    = d.topProducts[0];
    const growth = months.length >= 2
      ? (((months[months.length-1][1] - months[0][1]) / months[0][1]) * 100).toFixed(1)
      : null;

    return [
      `💰 Total Revenue: ₹${d.totalRevenue.toLocaleString("en-IN")}`,
      `📅 Monthly Trend:\n${trend}`,
      growth ? `📈 Revenue grew by ${growth}% over the tracked period.` : "",
      `\n🏆 Top earner: ${top?.name} with ₹${top?.revenue?.toLocaleString("en-IN")} across ${top?.orders} orders.`,
      `\n📦 Category Breakdown:\n${Object.entries(d.revenueByCategory).sort((a,b)=>b[1]-a[1]).map(([c,v]) => `  • ${c}: ₹${v.toLocaleString("en-IN")}`).join("\n")}`,
    ].filter(Boolean).join("\n");
  }

  // ── ORDERS ──
  if (q.includes("order") || q.includes("fulfillment") || q.includes("deliver") || q.includes("pending") || q.includes("processing")) {
    return [
      `📦 Order Report:`,
      `  • Total Orders: ${d.total}`,
      `  • ✅ Delivered: ${d.delivered} (${d.total ? ((d.delivered/d.total)*100).toFixed(1) : 0}%)`,
      `  • ⏳ Pending: ${d.pending}`,
      `  • 🔄 Processing: ${d.processing}`,
      `  • ❌ Cancelled: ${d.cancelled} (${d.cancellationRate}%)`,
      `  • 💳 Avg Order Value: ₹${d.avgOrderValue.toLocaleString("en-IN")}`,
      `\n${d.pending > 10 ? `⚠️ ${d.pending} orders are still pending — immediate follow-up recommended.` : "✅ Pending orders are within a manageable range."}`,
      d.cancellationRate > 7 ? `\n🚨 Cancellation rate of ${d.cancellationRate}% is above healthy threshold (5%). Investigate payment failures or delivery delays.` : `\n✅ Cancellation rate is within acceptable limits.`,
    ].join("\n");
  }

  // ── PRODUCTS ──
  if (q.includes("product") || q.includes("top") || q.includes("best") || q.includes("perform")) {
    return [
      `🏆 Top 5 Products by Revenue:`,
      ...d.topProducts.map((p, i) =>
        `  ${i+1}. ${p.name} — ₹${p.revenue.toLocaleString("en-IN")} | ${p.orders} orders | +${p.growth}% growth | ${p.category}`
      ),
      `\n📈 Fastest growing: ${[...d.fastGrowing].sort((a,b)=>b.growthPercent-a.growthPercent)[0]?.name || "N/A"}`,
      d.slowMoving.length ? `\n⚠️ Slow-moving products (< 2 orders): ${d.slowMoving.map(p=>p.name).join(", ")}` : "",
    ].filter(Boolean).join("\n");
  }

  // ── STOCK / INVENTORY ──
  if (q.includes("stock") || q.includes("inventory") || q.includes("restock") || q.includes("supply")) {
    return [
      d.outOfStock.length
        ? `🚨 Out of Stock — Reorder immediately:\n${d.outOfStock.map(p=>`  • ${p.name} (₹${p.price?.toLocaleString("en-IN")})`).join("\n")}`
        : "✅ No products are out of stock.",
      d.lowStock.length
        ? `\n⚠️ Low Stock — Restock soon:\n${d.lowStock.map(p=>`  • ${p.name}: ${p.stock} units left`).join("\n")}`
        : "\n✅ All other products have healthy stock levels.",
      d.fastGrowing.filter(p=>p.stock<100).length
        ? `\n📈 High-growth + low stock (priority):\n${d.fastGrowing.filter(p=>p.stock<100).map(p=>`  • ${p.name}: +${p.growthPercent}% growth, only ${p.stock} units`).join("\n")}`
        : "",
    ].filter(Boolean).join("\n");
  }

  // ── CATEGORY ──
  if (q.includes("categor") || q.includes("electronic") || q.includes("apparel") || q.includes("home")) {
    const sorted = Object.entries(d.revenueByCategory).sort((a,b)=>b[1]-a[1]);
    const total  = sorted.reduce((s,[,v])=>s+v,0);
    return [
      `📊 Revenue by Category:`,
      ...sorted.map(([cat, rev]) =>
        `  • ${cat}: ₹${rev.toLocaleString("en-IN")} (${total ? ((rev/total)*100).toFixed(1) : 0}%)`
      ),
      `\n🏆 Best performing: ${sorted[0]?.[0]}`,
      `📉 Needs attention: ${sorted[sorted.length-1]?.[0]} — consider promotions to boost this category.`,
    ].join("\n");
  }

  // ── CANCELLATIONS ──
  if (q.includes("cancel")) {
    return [
      `🚫 Cancellation Report:`,
      `  • Cancelled Orders: ${d.cancelled} out of ${d.total}`,
      `  • Cancellation Rate: ${d.cancellationRate}%`,
      `\n${d.cancellationRate > 10
        ? `❌ Rate is critically high! Check: payment gateway failures, long delivery times, or product quality issues.`
        : d.cancellationRate > 5
        ? `⚠️ Rate is slightly above normal. Send order confirmation emails and set clear delivery expectations.`
        : `✅ Cancellation rate is healthy and within normal range.`}`,
    ].join("\n");
  }

  // ── OFFERS / DISCOUNTS ──
  if (q.includes("offer") || q.includes("discount") || q.includes("promo") || q.includes("sale") || q.includes("deal")) {
    const slow = d.slowMoving.slice(0, 3);
    const top  = d.topProducts[0];
    return [
      slow.length
        ? `💸 Slow-moving products — run targeted discounts:\n${slow.map(p => {
            const discount = p.price > 2000 ? "15%" : "10%";
            return `  • ${p.name}: only ${d.ordersByProduct[p.name]||0} orders → suggest ${discount} off`;
          }).join("\n")}`
        : "✅ All products are moving well — no urgent discount needed.",
      d.outOfStock.length
        ? `\n🎯 Flash sale candidates after restocking:\n${d.outOfStock.map(p=>`  • ${p.name} — demand likely high`).join("\n")}`
        : "",
      top ? `\n🏆 Bundle deal idea: Pair "${top.name}" (top seller) with a slow-mover for a combo offer.` : "",
    ].filter(Boolean).join("\n");
  }

  // ── SUMMARY / DEFAULT ──
  const alerts = [];
  if (d.outOfStock.length)      alerts.push(`🚨 ${d.outOfStock.length} products out of stock`);
  if (d.lowStock.length)        alerts.push(`⚠️ ${d.lowStock.length} products low on stock`);
  if (d.cancellationRate > 5)   alerts.push(`❌ Cancellation rate ${d.cancellationRate}% — above normal`);
  if (d.slowMoving.length)      alerts.push(`💸 ${d.slowMoving.length} slow-moving products`);
  if (d.pending > 10)           alerts.push(`⏳ ${d.pending} orders still pending`);

  return [
    `📊 Report Summary:`,
    `  • Total Revenue: ₹${d.totalRevenue.toLocaleString("en-IN")}`,
    `  • Total Orders: ${d.total} | Delivered: ${d.delivered} | Cancelled: ${d.cancelled}`,
    `  • Avg Order Value: ₹${d.avgOrderValue.toLocaleString("en-IN")}`,
    `  • Cancellation Rate: ${d.cancellationRate}%`,
    `  • Top Product: ${d.topProducts[0]?.name || "N/A"} (₹${d.topProducts[0]?.revenue?.toLocaleString("en-IN")})`,
    alerts.length ? `\n🔔 Action Items:\n${alerts.map(a=>`  ${a}`).join("\n")}` : `\n✅ Everything looks good!`,
    `\nAsk me about: revenue, orders, products, stock, categories, cancellations, or offers.`,
  ].join("\n");
}

// ── POST /api/report-chat ──────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "message required" });

  try {
    const data  = await getReportData();
    const reply = generateReportReply(message, data);
    res.json({ reply });
  } catch (err) {
    console.error("Report chat error:", err.message);
    res.status(500).json({ error: "Analysis failed" });
  }
});

module.exports = router;