const mongoose = require("mongoose");

const superAdminSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  name: { type: String, default: "Super Admin" },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("SuperAdmin", superAdminSchema);