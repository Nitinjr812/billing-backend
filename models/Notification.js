const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["outOfStock", "lowStock", "slowMoving", "discountGiven"],
      required: true,
    },
    shopId: { type: String }, // future filtering ke liye, abhi optional
    productId: { type: String }, // ab required nahi — discountGiven me nahi hoga
    productName: { type: String },
    invoiceId: { type: String },
    staffName: { type: String },
    message: { type: String, required: true },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ productId: 1, type: 1, read: 1 });
notificationSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);