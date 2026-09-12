const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    shopId: { type: String, required: true },
    productId: { type: String, required: true },
    name: { type: String, required: true },
    stock: { type: Number, required: true, default: 0 },
    price: { type: Number, required: true },
    category: { type: String, required: true, trim: true },
    growthPercent: { type: Number, default: 0 },
    supplier: { type: String, default: "" },
  },
  { timestamps: true }
);

// productId ab globally unique nahi — sirf apni shop ke andar unique hona chahiye
productSchema.index({ shopId: 1, productId: 1 }, { unique: true });
productSchema.index({ shopId: 1, stock: 1 }); // alerts/sort queries ke liye

module.exports = mongoose.model("Product", productSchema);