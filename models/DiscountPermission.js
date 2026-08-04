const mongoose = require("mongoose");

const discountPermissionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  shopId: { type: String, required: true },
  canGiveDiscount: { type: Boolean, default: false },
  maxDiscountPercent: { type: Number, default: 0 }, // 0-100, staff ki bina-OTP limit
}, { timestamps: true });

module.exports = mongoose.model("DiscountPermission", discountPermissionSchema);