const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  productId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  stock: { type: Number, required: true, default: 0 },
  price: { type: Number, required: true },
  category: {
    type: String,
    enum: ["Electronics", "Apparel", "Home Goods"],
    required: true,
  },
  growthPercent: { type: Number, default: 0 },
});

module.exports = mongoose.model("Product", productSchema);