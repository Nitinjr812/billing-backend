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
  suspendedAt: { type: Date, default: null },

  // NEW: first-time shop verification (admin approves/rejects)
  // Default "approved" so existing shops are not locked out.
  verification: {
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "approved" },
    gstin: { type: String, default: "" },
    address: { type: String, default: "" },
    photos: { type: [String], default: [] }, // compressed JPEG data URIs
    submittedAt: { type: Date, default: null },
    reviewedAt: { type: Date, default: null },
    rejectReason: { type: String, default: "" },
  },

  subscription: {
    plan: { type: String, enum: ["free", "pro", "premium"], default: "free" },
    monthlyAmount: { type: Number, default: 0 },
    discountPercent: { type: Number, default: 0 },
    expiresAt: { type: Date, default: null },
    renewalHistory: [
      {
        date: { type: Date, default: Date.now },
        amount: { type: Number, required: true },
        plan: { type: String },
        orderId: { type: String, default: null },
        method: { type: String, default: "" },
      },
    ],
  },
});

module.exports = mongoose.model("Shop", shopSchema);