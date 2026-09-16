const mongoose = require("mongoose");

const shopSchema = new mongoose.Schema({
  shopId: { type: String, required: true, unique: true },
  shopName: { type: String, required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  createdAt: { type: Date, default: Date.now },
  gstin: { type: String, default: "" },
  defaultGstRate: { type: Number, default: 18 },
  navPermissions: {
    visibleToStaff: { type: [String], default: ["billing"] },
  },
  status: { type: String, enum: ["active", "suspended"], default: "active" },
  suspendedReason: { type: String, default: "" },

  subscription: {
    plan: { type: String, enum: ["free", "pro", "premium"], default: "free" },
    monthlyAmount: { type: Number, default: 0 },
    discountPercent: { type: Number, default: 0 },
    renewalHistory: [
      {
        date: { type: Date, default: Date.now },
        amount: { type: Number, required: true },
        plan: { type: String },
        orderId: { type: String, default: null }, // ⬅ NAYA — Cashfree order id, duplicate webhook process hone se rokta hai
      },
    ],
  },
});

module.exports = mongoose.model("Shop", shopSchema);