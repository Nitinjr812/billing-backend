const mongoose = require("mongoose");

const supplierPurchaseSchema = new mongoose.Schema(
  {
    purchaseId: { type: String, required: true, unique: true },
    supplier: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
    },
    supplierName: { type: String, required: true },
    description: { type: String, default: "" },
    amount: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },
    pendingAmount: { type: Number, default: 0 },
    dueDate: { type: Date, default: null },
    status: {
      type: String,
      enum: ["Paid", "Partially Paid", "Pending"],
      default: "Pending",
    },
    date: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Synchronous hook — no "next" argument needed at all
supplierPurchaseSchema.pre("save", function () {
  this.pendingAmount = Math.max(0, this.amount - this.paidAmount);

  if (this.paidAmount <= 0) {
    this.status = "Pending";
  } else if (this.pendingAmount <= 0) {
    this.status = "Paid";
  } else {
    this.status = "Partially Paid";
  }
});

module.exports = mongoose.model("SupplierPurchase", supplierPurchaseSchema);