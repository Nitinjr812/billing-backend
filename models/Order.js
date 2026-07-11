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

module.exports = mongoose.model("Order", orderSchema);