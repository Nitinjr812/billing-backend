const mongoose = require("mongoose");

const discountRequestSchema = new mongoose.Schema({
  shopId: { type: String, required: true },
  staffId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  staffName: { type: String, required: true },
  subtotal: { type: Number, required: true },
  discountType: { type: String, enum: ["flat", "percentage"], required: true },
  discountValue: { type: Number, required: true },
  discountAmount: { type: Number, required: true },
  discountPercent: { type: Number, required: true },
  otp: { type: String, required: true },
  otpExpires: { type: Date, required: true },
  verified: { type: Boolean, default: false },
  used: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model("DiscountRequest", discountRequestSchema);