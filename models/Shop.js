const mongoose = require("mongoose");

const shopSchema = new mongoose.Schema({
  shopId: { type: String, required: true, unique: true }, // e.g. "shop_a1b2c3"
  shopName: { type: String, required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  createdAt: { type: Date, default: Date.now },
  gstin: { type: String, default: "" },
  defaultGstRate: { type: Number, default: 18 },

  // ⬇️ NAYA FIELD — staff ko kaunse nav items dikhne hain (owner se set hota hai)
  navPermissions: {
    visibleToStaff: {
      type: [String], 
      default: ["billing"], // safe default jab tak owner khud configure na kare
    },
  },
});

module.exports = mongoose.model("Shop", shopSchema);