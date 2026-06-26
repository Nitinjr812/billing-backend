// ── MULTI-SHOP ANALYTICS ROUTER ─────────────────────────────────────────
const express = require("express");
const router = express.Router();
const { SHOPS, PRODUCTS, ORDERS } = require("./seedData");

// ── HELPER: Get shop analytics data ──────────────────────────────────────
function getShopAnalytics(shopId) {
  const shopOrders = ORDERS[shopId] || [];
  const shopProducts = PRODUCTS[shopId] || [];

  // Calculate stats
  const total = shopOrders.length;
  const delivered = shopOrders.filter((o) => o.status === "Delivered").length;
  const pending = shopOrders.filter((o) => o.status === "Pending").length;
  const processing = shopOrders.filter((o) => o.status === "Processing").length;
  const cancelled = shopOrders.filter((o) => o.status === "Cancelled").length;
  const cancellationRate = total ? ((cancelled / total) * 100).toFixed(1) : 0;

  const totalRevenue = shopOrders
    .filter((o) => o.status !== "Cancelled")
    .reduce((sum, o) => sum + o.amount, 0);

  // Revenue by product
  const revenueByProduct = {};
  const ordersByProduct = {};
  for (const o of shopOrders) {
    if (o.status !== "Cancelled") {
      revenueByProduct[o.product] = (revenueByProduct[o.product] || 0) + o.amount;
      ordersByProduct[o.product] = (ordersByProduct[o.product] || 0) + 1;
    }
  }

  // Stock alerts
  const lowStock = shopProducts.filter((p) => p.stock > 0 && p.stock < 20);
  const outOfStock = shopProducts.filter((p) => p.stock === 0);
  const slowMoving = shopProducts.filter((p) => (ordersByProduct[p.name] || 0) < 2);
  const fastGrowing = shopProducts.filter((p) => p.growthPercent >= 15);

  return {
    total,
    delivered,
    pending,
    processing,
    cancelled,
    cancellationRate,
    totalRevenue,
    revenueByProduct,
    ordersByProduct,
    lowStock,
    outOfStock,
    slowMoving,
    fastGrowing,
  };
}

// ── GET: All Shops (for dropdown selector) ──────────────────────────────
router.get("/shops", (req, res) => {
  const shopList = SHOPS.map((s) => ({
    shopId: s.shopId,
    name: s.name,
    city: s.city,
    category: s.category,
    status: s.status,
  }));
  res.json(shopList);
});

// ── GET: Specific shop details ───────────────────────────────────────────
router.get("/shop/:shopId", (req, res) => {
  const { shopId } = req.params;
  const shop = SHOPS.find((s) => s.shopId === shopId);

  if (!shop) {
    return res.status(404).json({ error: "Shop not found" });
  }

  res.json(shop);
});

// ── GET: Shop analytics/stats ───────────────────────────────────────────
router.get("/stats/:shopId", (req, res) => {
  const { shopId } = req.params;
  const analytics = getShopAnalytics(shopId);
  res.json(analytics);
});

// ── GET: Products for a shop ────────────────────────────────────────────
router.get("/products/:shopId", (req, res) => {
  const { shopId } = req.params;
  const products = PRODUCTS[shopId] || [];
  res.json(products);
});

// ── GET: Orders for a shop ──────────────────────────────────────────────
router.get("/orders/:shopId", (req, res) => {
  const { shopId } = req.params;
  const orders = ORDERS[shopId] || [];
  res.json(orders);
});

// ── GET: Stock alerts for a shop ────────────────────────────────────────
router.get("/alerts/:shopId", (req, res) => {
  const { shopId } = req.params;
  const analytics = getShopAnalytics(shopId);

  const alerts = [];

  // Out of stock alerts
  analytics.outOfStock.forEach((p) => {
    alerts.push({
      type: "OUT_OF_STOCK",
      severity: "critical",
      product: p.name,
      message: `${p.name} is out of stock! High demand (${p.growthPercent}% growth)`,
    });
  });

  // Low stock alerts
  analytics.lowStock.forEach((p) => {
    alerts.push({
      type: "LOW_STOCK",
      severity: "warning",
      product: p.name,
      message: `${p.name} running low (${p.stock} units left)`,
    });
  });

  // Slow movers
  analytics.slowMoving.forEach((p) => {
    if (p.stock > 20) {
      alerts.push({
        type: "SLOW_MOVING",
        severity: "info",
        product: p.name,
        message: `${p.name} is moving slowly. Consider offering discount.`,
      });
    }
  });

  res.json(alerts);
});

// ── GET: Dashboard snapshot (all data needed for dashboard) ──────────────
router.get("/dashboard/:shopId", (req, res) => {
  const { shopId } = req.params;

  const shop = SHOPS.find((s) => s.shopId === shopId);
  if (!shop) {
    return res.status(404).json({ error: "Shop not found" });
  }

  const products = PRODUCTS[shopId] || [];
  const orders = ORDERS[shopId] || [];
  const analytics = getShopAnalytics(shopId);

  // Top 5 orders by amount
  const topOrders = [...orders]
    .filter((o) => o.status !== "Cancelled")
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  // Top 5 products by revenue
  const topProducts = Object.entries(analytics.revenueByProduct)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  res.json({
    shop,
    stats: analytics,
    products,
    orders,
    topOrders,
    topProducts: topProducts.map(([name, revenue]) => ({
      name,
      revenue,
      orders: analytics.ordersByProduct[name] || 0,
    })),
  });
});

// ── POST: Add new product to shop (simulated) ───────────────────────────
router.post("/product/:shopId", (req, res) => {
  const { shopId } = req.params;
  const { name, category, price, costPrice, stock } = req.body;

  if (!PRODUCTS[shopId]) {
    PRODUCTS[shopId] = [];
  }

  const newProduct = {
    productId: `prod_${Date.now()}_${shopId}`,
    shopId,
    name,
    category,
    price,
    costPrice,
    stock,
    growthPercent: 0,
    totalSold: 0,
    lastRestocked: new Date(),
    createdAt: new Date(),
  };

  PRODUCTS[shopId].push(newProduct);
  res.json({ success: true, product: newProduct });
});

// ── POST: Add new order to shop (simulated) ─────────────────────────────
router.post("/order/:shopId", (req, res) => {
  const { shopId } = req.params;
  const { customer, product, productId, amount, quantity, paymentMethod } = req.body;

  if (!ORDERS[shopId]) {
    ORDERS[shopId] = [];
  }

  const newOrder = {
    orderId: `ord_${Date.now()}_${shopId}`,
    shopId,
    customer,
    product,
    productId,
    amount,
    quantity,
    status: "Pending",
    date: new Date(),
    paymentMethod,
  };

  ORDERS[shopId].push(newOrder);
  res.json({ success: true, order: newOrder });
});

// ── PUT: Update product stock ───────────────────────────────────────────
router.put("/product/:shopId/:productId", (req, res) => {
  const { shopId, productId } = req.params;
  const { stock } = req.body;

  const products = PRODUCTS[shopId] || [];
  const product = products.find((p) => p.productId === productId);

  if (!product) {
    return res.status(404).json({ error: "Product not found" });
  }

  product.stock = stock;
  product.lastRestocked = new Date();
  res.json({ success: true, product });
});

// ── PUT: Update order status ────────────────────────────────────────────
router.put("/order/:shopId/:orderId", (req, res) => {
  const { shopId, orderId } = req.params;
  const { status } = req.body;

  const orders = ORDERS[shopId] || [];
  const order = orders.find((o) => o.orderId === orderId);

  if (!order) {
    return res.status(404).json({ error: "Order not found" });
  }

  order.status = status;
  res.json({ success: true, order });
});

// ── DELETE: Remove product (soft delete) ────────────────────────────────
router.delete("/product/:shopId/:productId", (req, res) => {
  const { shopId, productId } = req.params;
  const products = PRODUCTS[shopId] || [];
  
  const index = products.findIndex((p) => p.productId === productId);
  if (index === -1) {
    return res.status(404).json({ error: "Product not found" });
  }

  products.splice(index, 1);
  res.json({ success: true, message: "Product deleted" });
});

module.exports = router;