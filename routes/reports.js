const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const Product = require("../models/Product");

router.get("/", async (req, res) => {
  try {
    const [orders, products] = await Promise.all([
      Order.find().sort({ date: -1 }),
      Product.find(),
    ]);

    const total = orders.length;
    const delivered = orders.filter((o) => o.status === "Delivered").length;
    const pending = orders.filter((o) => o.status === "Pending").length;
    const processing = orders.filter((o) => o.status === "Processing").length;
    const cancelled = orders.filter((o) => o.status === "Cancelled").length;
    const cancellationRate = total ? ((cancelled / total) * 100).toFixed(1) : 0;

    const validOrders = orders.filter((o) => o.status !== "Cancelled");
    const totalRevenue = validOrders.reduce((sum, o) => sum + o.amount, 0);
    const avgOrderValue = validOrders.length
      ? Math.round(totalRevenue / validOrders.length)
      : 0;

    // ── Revenue & Orders by Month ──
    const revenueByMonth = {};
    const ordersByMonth = {};
    for (const o of validOrders) {
      const month = new Date(o.date).toLocaleString("en-IN", { month: "short", year: "numeric" });
      revenueByMonth[month] = (revenueByMonth[month] || 0) + o.amount;
      ordersByMonth[month] = (ordersByMonth[month] || 0) + 1;
    }

    // ── Product lookup map (name → product doc) ──
    const productMap = {};
    products.forEach((p) => { productMap[p.name] = p; });

    // ── Revenue & Orders by Product ──
    const revenueByProduct = {};
    const ordersByProduct = {};
    for (const o of validOrders) {
      revenueByProduct[o.product] = (revenueByProduct[o.product] || 0) + o.amount;
      ordersByProduct[o.product] = (ordersByProduct[o.product] || 0) + 1;
    }

    // ── Revenue by Category (via product → category mapping) ──
    const revenueByCategory = {};
    for (const [productName, revenue] of Object.entries(revenueByProduct)) {
      const category = productMap[productName]?.category || "Other";
      revenueByCategory[category] = (revenueByCategory[category] || 0) + revenue;
    }

    // ── Top Products (by revenue) ──
    const topProducts = Object.entries(revenueByProduct)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, revenue]) => {
        const p = productMap[name];
        return {
          name,
          revenue,
          orders: ordersByProduct[name] || 0,
          growth: p?.growthPercent ?? 0,
          category: p?.category || "Other",
        };
      });

    // ── Stock Alerts ──
    const lowStock = products
      .filter((p) => p.stock > 0 && p.stock < 50)
      .map((p) => ({ name: p.name, stock: p.stock }));
    const outOfStock = products
      .filter((p) => p.stock === 0)
      .map((p) => ({ name: p.name, stock: p.stock }));

    res.json({
      summary: {
        total,
        delivered,
        pending,
        processing,
        cancelled,
        cancellationRate,
        totalRevenue,
        avgOrderValue,
      },
      revenueByMonth,
      ordersByMonth,
      revenueByCategory,
      topProducts,
      stock: { lowStock, outOfStock },
    });
  } catch (err) {
    console.error("Reports error:", err.message);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

module.exports = router;