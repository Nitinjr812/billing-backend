const mongoose = require("mongoose");

const shopSchema = new mongoose.Schema({
  shopId: { type: String, required: true, unique: true },
  shopName: { type: String, required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  createdAt: { type: Date, default: Date.now },
  gstin: { type: String, default: "" },
  defaultGstRate: { type: Number, default: 18 },
  navPermissions: {
    visibleToStaff: {
      type: [String],
      default: ["billing"],
    },
  },
});

module.exports = mongoose.model("Shop", shopSchema);