const mongoose = require("mongoose");

const adminMessageSchema = new mongoose.Schema({
  shopId: { type: String, required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String, enum: ["offer", "announcement", "warning"], default: "offer" },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("AdminMessage", adminMessageSchema);