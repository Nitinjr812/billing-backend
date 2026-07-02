// ── SHOP MODEL ──────────────────────────────────────────────────────────
const shopSchema = {
  shopId: String,          // "shop_001", "shop_002", etc.
  name: String,            // "Arjun Electronics", "Priya Fashion", etc.
  email: String,
  phone: String,
  city: String,            // "Jaipur", "Delhi", "Mumbai"
  category: String,        // "Electronics", "Fashion", "Home", etc.
  createdAt: Date,
  status: String,          // "active", "inactive"
  totalRevenue: Number,    // Overall lifetime revenue
  totalOrders: Number,     // Overall total orders
};

// ── PRODUCT MODEL ───────────────────────────────────────────────────────
const productSchema = {
  productId: String,       // "prod_001", "prod_002"
  shopId: String,          // Link to shop (FK)
  name: String,
  category: String,
  price: Number,
  stock: Number,
  costPrice: Number,       // For profit margin calculation
  growthPercent: Number,   // Monthly growth %
  totalSold: Number,       // Lifetime units sold
  lastRestocked: Date,
  createdAt: Date,
};

// ── ORDER MODEL ──────────────────────────────────────────────────────────
const orderSchema = {
  orderId: String,         // "ord_001", "ord_002"
  shopId: String,          // Link to shop (FK)
  customer: String,
  product: String,         // Product name
  productId: String,
  amount: Number,
  quantity: Number,
  status: String,          // "Delivered", "Pending", "Processing", "Cancelled"
  date: Date,
  paymentMethod: String,   // "Card", "UPI", "Cash", etc.
};

// ── INVENTORY LOG (for tracking changes) ──────────────────────────────
const inventoryLogSchema = {
  logId: String,
  shopId: String,
  productId: String,
  action: String,          // "sold", "restocked", "adjustment"
  quantity: Number,
  previousStock: Number,
  newStock: Number,
  date: Date,
};

// ── ALERT MODEL (for low stock, etc.) ─────────────────────────────────
const alertSchema = {
  alertId: String,
  shopId: String,
  productId: String,
  type: String,             
  severity: String,        
  message: String,
  resolved: Boolean,
  createdAt: Date,
};

module.exports = {
  shopSchema,
  productSchema,
  orderSchema,
  inventoryLogSchema,
  alertSchema,
};