const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, enum: ["owner", "staff"], required: true },
  shopId: { type: String, required: true },
  phone: { type: String, default: "" },
  isVerified: { type: Boolean, default: false },
  otp: { type: String },
  otpExpires: { type: Date },
  notificationSettings: {
    revenueAlerts: { type: Boolean, default: true },
    newOrders: { type: Boolean, default: true },
    lowInventory: { type: Boolean, default: true },
    cancellationSpikes: { type: Boolean, default: false },
    newCustomers: { type: Boolean, default: false },
    weeklyReports: { type: Boolean, default: true },
  },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("User", userSchema);