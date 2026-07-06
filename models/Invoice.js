const mongoose = require("mongoose");

const invoiceSchema = new mongoose.Schema({
  invoiceId: { type: String, required: true, unique: true },
  customerName: { type: String, required: true },
  customerEmail: { type: String, default: "" },
  customerPhone: { type: String, default: "" },
  items: [
    {
      name: { type: String, required: true },
      qty: { type: Number, required: true },
      price: { type: Number, required: true },
    },
  ],
  total: { type: Number, required: true },
}, { timestamps: true });

module.exports = mongoose.model("Invoice", invoiceSchema);