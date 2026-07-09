const mongoose = require("mongoose");

const supplierSchema = new mongoose.Schema(
  {
    supplierId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    category: {
      type: String,
      enum: ["Electronics", "Apparel", "Home Goods"],
      required: true,
    },
    contact: { type: String, required: true },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    location: { type: String, default: "" },
    status: {
      type: String,
      enum: ["Active", "On Hold", "Inactive"],
      default: "Active",
    },
    paymentTerms: { type: String, default: "Net 30" },
    rating: { type: Number, min: 0, max: 5, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Supplier", supplierSchema);