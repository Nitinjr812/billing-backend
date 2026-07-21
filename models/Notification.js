const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["outOfStock", "lowStock", "slowMoving"],
      required: true,
    },
    productId: { type: String, required: true }, // matches Product.productId
    productName: { type: String, required: true },
    message: { type: String, required: true },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Powers the "don't spam duplicate alerts" check in scan-stock
notificationSchema.index({ productId: 1, type: 1, read: 1 });
notificationSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);