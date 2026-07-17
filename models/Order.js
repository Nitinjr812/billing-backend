const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  customer: { type: String, required: true },
  amount: { type: Number, required: true },
  status: {
    type: String,
    enum: ["Completed", "Pending", "Cancelled"],
    default: "Completed",
  },
  product: { type: String, required: true },
  qty: { type: Number, default: 1 },
  date: { type: Date, default: Date.now },
});

// Indexes — without these, every /api/orders and /api/orders/stats
// query does a full collection scan. This is the single biggest
// speed fix as order count grows.
orderSchema.index({ date: -1 });      // powers .sort({ date: -1 })
orderSchema.index({ status: 1 });     // powers stats aggregation / filters

module.exports = mongoose.model("Order", orderSchema);