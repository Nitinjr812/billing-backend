const mongoose = require("mongoose");

const restockItemSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  qty: { type: String, default: "" },   // string on purpose — shopkeeper can type "5kg", "2 dozen" etc.
  unit: { type: String, default: "" },
}, { _id: false });

const restockOrderSchema = new mongoose.Schema({
  shopId: { type: String, required: true },
  supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", default: null }, // null = ad-hoc, no saved supplier
  supplierName: { type: String, default: "" },
  phone: { type: String, default: "" },
  items: { type: [restockItemSchema], default: [] },
  status: { type: String, enum: ["Pending", "Completed"], default: "Pending" },
  expectedDate: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, { timestamps: true }); // gives createdAt / updatedAt automatically

restockOrderSchema.index({ shopId: 1, createdAt: -1 });
restockOrderSchema.index({ shopId: 1, status: 1 });

module.exports = mongoose.model("RestockOrder", restockOrderSchema);