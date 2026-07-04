const mongoose = require("mongoose");

const shopSchema = new mongoose.Schema({
  shopId: { type: String, required: true, unique: true }, // e.g. "shop_a1b2c3"
  shopName: { type: String, required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Shop", shopSchema);