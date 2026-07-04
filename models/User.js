const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true }, // hashed, kabhi plain text nahi
  role: { type: String, enum: ["owner", "staff"], required: true },
  shopId: { type: String, required: true }, // Shop.shopId se link
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("User", userSchema);