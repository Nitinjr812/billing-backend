const express = require("express");
const router = express.Router();
const Order = require("../models/Order");
const Product = require("../models/Product");

const GST_RATES = {
  Electronics: 18,
  Apparel: 5,
  "Home Goods": 12,
  Other: 18,
};

// ── GET /api/export/csv ────────────────────────────────────────────────────────
router.get("/csv", async (req, res) => {
  try {
    const [orders, products] = await Promise.all([
      Order.find().sort({ date: -1 }),
      Product.find(),
    ]);

    const productMap = {};
    for (const p of products) productMap[p.name] = p;

    // ── Helper ──
    const escape = (val) => {
      const str = String(val ?? "");
      return str.includes(",") || str.includes('"') || str.includes("\n")
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    };

    const rows = [];

    // ══ SECTION 1: Business Summary ══════════════════════════════════════════
    rows.push(["BUSINESS REPORT — GST INCLUDED"]);
    rows.push([`Generated On`, new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })]);
    rows.push([]);

    const validOrders    = orders.filter((o) => o.status !== "Cancelled");
    const totalRevenue   = validOrders.reduce((s, o) => s + o.amount, 0);
    const totalOrders    = orders.length;
    const delivered      = orders.filter((o) => o.status === "Delivered").length;
    const pending        = orders.filter((o) => o.status === "Pending").length;
    const processing     = orders.filter((o) => o.status === "Processing").length;
    const cancelled      = orders.filter((o) => o.status === "Cancelled").length;
    const cancellationRate = totalOrders ? ((cancelled / totalOrders) * 100).toFixed(1) : 0;
    const avgOrderValue  = validOrders.length ? Math.round(totalRevenue / validOrders.length) : 0;

    rows.push(["── SUMMARY ──"]);
    rows.push(["Metric", "Value"]);
    rows.push(["Total Revenue (excl. cancelled)", `Rs ${totalRevenue.toLocaleString("en-IN")}`]);
    rows.push(["Total Orders", totalOrders]);
    rows.push(["Delivered", delivered]);
    rows.push(["Pending", pending]);
    rows.push(["Processing", processing]);
    rows.push(["Cancelled", cancelled]);
    rows.push(["Cancellation Rate", `${cancellationRate}%`]);
    rows.push(["Average Order Value", `Rs ${avgOrderValue.toLocaleString("en-IN")}`]);
    rows.push([]);

    // ══ SECTION 2: GST Breakdown by Category ═════════════════════════════════
    rows.push(["── GST BREAKDOWN BY CATEGORY ──"]);
    rows.push(["Category", "GST Rate (%)", "Taxable Amount (Rs)", "GST Amount (Rs)", "Total incl. GST (Rs)"]);

    const categoryRevenue = {};
    for (const o of validOrders) {
      const cat = productMap[o.product]?.category || "Other";
      categoryRevenue[cat] = (categoryRevenue[cat] || 0) + o.amount;
    }

    let grandTaxable = 0;
    let grandGst     = 0;
    let grandTotal   = 0;

    for (const [cat, rev] of Object.entries(categoryRevenue).sort((a, b) => b[1] - a[1])) {
      const gstRate    = GST_RATES[cat] ?? 18;
      const taxable    = Math.round(rev / (1 + gstRate / 100));
      const gstAmt     = rev - taxable;
      grandTaxable    += taxable;
      grandGst        += gstAmt;
      grandTotal      += rev;
      rows.push([cat, `${gstRate}%`, taxable.toLocaleString("en-IN"), gstAmt.toLocaleString("en-IN"), rev.toLocaleString("en-IN")]);
    }

    rows.push(["TOTAL", "", grandTaxable.toLocaleString("en-IN"), grandGst.toLocaleString("en-IN"), grandTotal.toLocaleString("en-IN")]);
    rows.push([]);

    // ══ SECTION 3: Order-wise Detail ═════════════════════════════════════════
    rows.push(["── ORDER-WISE DETAIL (GST INCLUDED) ──"]);
    rows.push(["Order ID", "Customer", "Product", "Category", "GST Rate (%)", "Amount incl. GST (Rs)", "Taxable Amount (Rs)", "GST Amount (Rs)", "Status", "Date"]);

    for (const o of orders) {
      const cat     = productMap[o.product]?.category || "Other";
      const gstRate = GST_RATES[cat] ?? 18;
      const taxable = o.status !== "Cancelled" ? Math.round(o.amount / (1 + gstRate / 100)) : 0;
      const gstAmt  = o.status !== "Cancelled" ? o.amount - taxable : 0;
      const date    = new Date(o.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

      rows.push([
        escape(o.orderId),
        escape(o.customer),
        escape(o.product),
        escape(cat),
        `${gstRate}%`,
        o.amount.toLocaleString("en-IN"),
        taxable ? taxable.toLocaleString("en-IN") : "—",
        gstAmt  ? gstAmt.toLocaleString("en-IN")  : "—",
        escape(o.status),
        date,
      ]);
    }
    rows.push([]);

    // ══ SECTION 4: Product / Stock Report ════════════════════════════════════
    rows.push(["── PRODUCT & STOCK REPORT ──"]);
    rows.push(["Product", "Category", "Price (Rs)", "GST Rate (%)", "Price excl. GST (Rs)", "GST on Price (Rs)", "Stock (units)", "Growth (%)", "Status"]);

    for (const p of products.sort((a, b) => a.name.localeCompare(b.name))) {
      const gstRate  = GST_RATES[p.category] ?? 18;
      const priceExGst = Math.round(p.price / (1 + gstRate / 100));
      const gstOnPrice = p.price - priceExGst;
      const status   = p.stock === 0 ? "Out of Stock" : p.stock < 50 ? "Low Stock" : "In Stock";

      rows.push([
        escape(p.name),
        escape(p.category),
        p.price.toLocaleString("en-IN"),
        `${gstRate}%`,
        priceExGst.toLocaleString("en-IN"),
        gstOnPrice.toLocaleString("en-IN"),
        p.stock,
        `+${p.growthPercent}%`,
        status,
      ]);
    }
    rows.push([]);

    // ══ SECTION 5: Top Products by Revenue ═══════════════════════════════════
    rows.push(["── TOP PRODUCTS BY REVENUE ──"]);
    rows.push(["Rank", "Product", "Category", "Total Revenue (Rs)", "Orders", "Taxable (Rs)", "GST (Rs)", "Growth (%)"]);

    const revenueByProduct = {};
    const ordersByProduct  = {};
    for (const o of validOrders) {
      revenueByProduct[o.product] = (revenueByProduct[o.product] || 0) + o.amount;
      ordersByProduct[o.product]  = (ordersByProduct[o.product]  || 0) + 1;
    }

    Object.entries(revenueByProduct)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([name, rev], i) => {
        const cat      = productMap[name]?.category || "Other";
        const gstRate  = GST_RATES[cat] ?? 18;
        const taxable  = Math.round(rev / (1 + gstRate / 100));
        const gstAmt   = rev - taxable;
        const growth   = productMap[name]?.growthPercent || 0;
        rows.push([
          i + 1,
          escape(name),
          escape(cat),
          rev.toLocaleString("en-IN"),
          ordersByProduct[name] || 0,
          taxable.toLocaleString("en-IN"),
          gstAmt.toLocaleString("en-IN"),
          `+${growth}%`,
        ]);
      });

    // ── Build CSV string ──
    const csv = rows.map((r) => r.join(",")).join("\n");
    const filename = `business-report-gst-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send("\uFEFF" + csv); // BOM for Excel UTF-8
  } catch (err) {
    console.error("CSV export error:", err.message);
    res.status(500).json({ error: "Export failed" });
  }
});

module.exports = router;