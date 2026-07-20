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

  // ── Pricing breakdown (all calculated server-side for safety) ──────────
  subtotal: { type: Number, required: true },        // sum of qty*price across items

  discountType: { type: String, enum: ["flat", "percentage"], default: "flat" },
  discountValue: { type: Number, default: 0 },        // raw value entered by shopkeeper
  discountAmount: { type: Number, default: 0 },        // calculated ₹ amount actually deducted

  gstRate: { type: Number, default: 0 },              // % applied to taxable amount
  gstAmount: { type: Number, default: 0 },              // calculated ₹ GST

  sellerGstin: { type: String, default: "" },          // snapshot of shop's GSTIN at invoice time

  total: { type: Number, required: true },              // grand total (subtotal - discount + gst)
}, { timestamps: true });

module.exports = mongoose.model("Invoice", invoiceSchema);