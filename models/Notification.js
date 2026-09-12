const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  shopId: { type: String, required: true },
  type: {
    type: String,
    enum: ["outOfStock", "lowStock", "slowMoving", "task_assigned", "task_completed", "announcement"],
    required: true,
  },
  title: { type: String, required: true },
  message: { type: String, required: true },
  recipientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", default: null },
  productId: { type: String, default: null },
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  createdAt: { type: Date, default: Date.now },
});

// 30 din baad automatically delete ho jayegi — storage kabhi accumulate nahi hoga
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model("Notification", notificationSchema);