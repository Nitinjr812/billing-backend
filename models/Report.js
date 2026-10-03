const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema(
  {
    shopId: { type: String, required: true, index: true },
    shopName: { type: String, default: "" },
    category: { type: String, enum: ["bug", "billing", "feature", "other"], default: "other" },
    priority: { type: String, enum: ["low", "medium", "high"], default: "medium" },
    status: { type: String, enum: ["open", "in_progress", "resolved"], default: "open", index: true },
    subject: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    reply: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Report", reportSchema);