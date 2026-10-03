const mongoose = require("mongoose");

const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    audience: { type: String, default: "all" }, // "all" | "free" | "pro" | "premium"
    recipients: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Announcement", announcementSchema);