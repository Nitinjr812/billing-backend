const mongoose = require("mongoose");

const supplierPurchaseSchema = new mongoose.Schema(
  {
    purchaseId: { type: String, required: true, unique: true },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
    },
    supplierName: { type: String, required: true }, // denormalized for fast reads
    description: { type: String, default: "" }, // e.g. "24 gold chains, 5g each"
    amount: { type: Number, required: true, min: 0 }, // total purchase value
    paidAmount: { type: Number, default: 0, min: 0 },
    pendingAmount: { type: Number, default: 0 }, // auto-calculated below
    status: {
      type: String,
      enum: ["Paid", "Partially Paid", "Pending"],
      default: "Pending",
    },
    date: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Auto-calc pendingAmount + status before every save
supplierPurchaseSchema.pre("save", function (next) {
  this.pendingAmount = Math.max(0, this.amount - this.paidAmount);

  if (this.paidAmount <= 0) {
    this.status = "Pending";
  } else if (this.pendingAmount <= 0) {
    this.status = "Paid";
  } else {
    this.status = "Partially Paid";
  }

  next();
});

module.exports = mongoose.model("SupplierPurchase", supplierPurchaseSchema);