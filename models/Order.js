const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
  shopId: { type: String, required: true },
  orderId: { type: String, required: true },
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

orderSchema.index({ shopId: 1, orderId: 1 }, { unique: true });
orderSchema.index({ shopId: 1, date: -1 });
orderSchema.index({ shopId: 1, status: 1 });

module.exports = mongoose.model("Order", orderSchema);