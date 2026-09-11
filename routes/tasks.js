const express = require("express");
const router = express.Router();
const Task = require("../models/Task");
const Notification = require("../models/Notification");
const User = require("../models/User");
const { verifyToken, requireRole } = require("../middleware/auth");

router.use(verifyToken);

// ── GET tasks (owner: sab shop ke tasks, staff: sirf apne) ──────────────
router.get("/", async (req, res) => {
  try {
    const { userId, shopId, role } = req.user;
    const filter = { shopId };
    if (role !== "owner") filter.assignedTo = userId;

    const tasks = await Task.find(filter)
      .sort({ createdAt: -1 })
      .populate("assignedTo", "name email")
      .populate("assignedBy", "name");

    res.json(tasks);
  } catch (err) {
    console.error("Tasks fetch error:", err.message);
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

// ── POST create + assign a task (owner only) ─────────────────────────
router.post("/", requireRole("owner"), async (req, res) => {
  try {
    const { title, description, deadline, priority, assignedTo } = req.body;
    if (!title || !assignedTo) {
      return res.status(400).json({ error: "title and assignedTo are required" });
    }
    if (!["low", "medium", "high"].includes(priority)) {
      return res.status(400).json({ error: "Invalid priority" });
    }

    const target = await User.findById(assignedTo);
    if (!target || target.shopId !== req.user.shopId) {
      return res.status(404).json({ error: "Assignee not found in your shop" });
    }

    const task = await Task.create({
      shopId: req.user.shopId,
      title,
      description: description || "",
      deadline: deadline ? new Date(deadline) : null,
      priority,
      assignedTo,
      assignedBy: req.user.userId,
    });

    const deadlineText = deadline ? ` · Due ${new Date(deadline).toLocaleDateString("en-IN")}` : "";
    await Notification.create({
      shopId: req.user.shopId,
      type: "task_assigned",
      title: `New task: ${title}`,
      message: `${description || "No description"} · Priority: ${priority}${deadlineText}`,
      recipientId: assignedTo,
      taskId: task._id,
    });

    const populated = await task.populate([
      { path: "assignedTo", select: "name email" },
      { path: "assignedBy", select: "name" },
    ]);

    res.json({ success: true, task: populated });
  } catch (err) {
    console.error("Task create error:", err.message);
    res.status(500).json({ error: "Failed to create task" });
  }
});

// ── PATCH mark task as done (sirf jisko assign hua wahi complete kar sakta) ──
router.patch("/:id/complete", async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task || task.shopId !== req.user.shopId) {
      return res.status(404).json({ error: "Task not found" });
    }
    if (task.assignedTo.toString() !== req.user.userId.toString()) {
      return res.status(403).json({ error: "Only the assignee can complete this task" });
    }
    if (task.status === "done") {
      return res.status(400).json({ error: "Task already completed" });
    }

    task.status = "done";
    task.completedAt = new Date();
    await task.save();

    const me = await User.findById(req.user.userId).select("name");
    await Notification.create({
      shopId: req.user.shopId,
      type: "task_completed",
      title: "Task completed",
      message: `${me?.name || "An employee"} marked "${task.title}" as done.`,
      recipientId: task.assignedBy,
      taskId: task._id,
    });

    res.json({ success: true, task });
  } catch (err) {
    console.error("Task complete error:", err.message);
    res.status(500).json({ error: "Failed to complete task" });
  }
});

module.exports = router;