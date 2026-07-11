const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    stock: { type: Number, required: true, default: 0 },
    price: { type: Number, required: true },
    // Free-text category — no enum restriction, so users can type their own
    // category name. Frequently-used categories are suggested in the UI
    // (see Inventory.jsx datalist), but any value is accepted here.
    category: {
      type: String,
      required: true,
      trim: true,
    },
    growthPercent: { type: Number, default: 0 },
    supplier: { type: String, default: "" }, /  / matches Supplier.name for linking
  },
  { timestamps: true }
);

module.exports = mongoose.model("Product", productSchema);