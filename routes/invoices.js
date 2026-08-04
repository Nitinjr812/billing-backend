const express = require("express");
const router = express.Router();
const Invoice = require("../models/Invoice");
const Product = require("../models/Product");
const Order = require("../models/Order");
const User = require("../models/User");
const Shop = require("../models/Shop");
const Notification = require("../models/Notification");
const DiscountPermission = require("../models/DiscountPermission");
const DiscountRequest = require("../models/DiscountRequest");
const { generateInvoicePdfBuffer } = require("../utils/generateInvoicePdf");
const { sendInvoicePdfToWhatsapp } = require("../services/whatsapp");
const sendOTPEmail = require("../utils/sendEmail");
const { verifyToken } = require("../middleware/auth");

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();
const otpExpiry = () => Date.now() + 10 * 60 * 1000;

router.use(verifyToken); // ab invoices banane ke liye login zaroori hai

// ── helper: subtotal/discount ka common calculation ─────────────────────
function calcDiscount(items, discountType, discountValue) {
  const subtotal = items.reduce(
    (sum, it) => sum + (Number(it.qty) || 0) * (Number(it.price) || 0),
    0
  );
  const safeDiscountType = discountType === "percentage" ? "percentage" : "flat";
  const safeDiscountValue = Math.max(0, Number(discountValue) || 0);

  let discountAmount = 0;
  if (safeDiscountType === "percentage") {
    discountAmount = subtotal * (Math.min(100, safeDiscountValue) / 100);
  } else {
    discountAmount = Math.min(subtotal, safeDiscountValue);
  }
  const discountPercent = subtotal > 0 ? (discountAmount / subtotal) * 100 : 0;

  return { subtotal, safeDiscountType, safeDiscountValue, discountAmount, discountPercent };
}

// ── POST /api/invoices/check-discount ────────────────────────────────────
// Frontend isko discount apply karne se PEHLE call karega
router.post("/check-discount", async (req, res) => {
  try {
    const { items, discountType, discountValue } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: "Items required" });

    const { subtotal, discountAmount, discountPercent } = calcDiscount(items, discountType, discountValue);

    // Owner khud kabhi bhi discount de sakta hai, koi limit nahi
    if (req.user.role === "owner" || discountAmount <= 0) {
      return res.json({ allowed: true });
    }

    const perm = await DiscountPermission.findOne({ userId: req.user.userId });
    if (!perm || !perm.canGiveDiscount) {
      return res.status(403).json({ error: "Aapko discount dene ki permission nahi hai. Owner se contact karein." });
    }

    if (discountPercent <= perm.maxDiscountPercent) {
      return res.json({ allowed: true });
    }

    // Limit se jyada — OTP flow trigger
    const shop = await Shop.findOne({ shopId: req.user.shopId });
    const owner = await User.findById(shop.ownerId);
    if (!owner) return res.status(404).json({ error: "Shop owner not found" });

    const staff = await User.findById(req.user.userId);
    const otp = generateOTP();

    const request = await DiscountRequest.create({
      shopId: req.user.shopId,
      staffId: req.user.userId,
      staffName: staff.name,
      subtotal,
      discountType: discountType === "percentage" ? "percentage" : "flat",
      discountValue: Number(discountValue) || 0,
      discountAmount,
      discountPercent,
      otp,
      otpExpires: otpExpiry(),
    });

  await sendOTPEmail(owner.email, otp, "discount-approval", {
  staffName: staff.name,
  customerName: req.body.customerName || "",
  discountAmount,
});

    return res.json({
      allowed: false,
      otpRequired: true,
      requestId: request._id,
      message: `Discount limit (${perm.maxDiscountPercent}%) se jyada hai. OTP owner ke email pe bheja gaya hai.`,
    });
  } catch (err) {
    console.error("Check discount error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/invoices/verify-discount-otp ───────────────────────────────
router.post("/verify-discount-otp", async (req, res) => {
  try {
    const { requestId, otp } = req.body;
    const request = await DiscountRequest.findById(requestId);

    if (!request) return res.status(404).json({ error: "Request not found" });
    if (request.staffId.toString() !== req.user.userId.toString()) {
      return res.status(403).json({ error: "Not your request" });
    }
    if (request.used) return res.status(400).json({ error: "This OTP already used" });
    if (!request.otp || request.otp !== otp || request.otpExpires < Date.now()) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    request.verified = true;
    await request.save();

    res.json({ success: true, approvalId: request._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/invoices — create invoice (ab discount server-side re-verify hota hai) ──
router.post("/", async (req, res) => {
  try {
    const {
      customerName, customerEmail, customerPhone, items, status,
      discountType, discountValue, gstRate, sellerGstin,
      approvalId, // agar OTP se verify hua discount hai to ye aayega
    } = req.body;

    if (!customerName || !items || !items.length) {
      return res.status(400).json({ error: "Customer name and items are required" });
    }

    const { subtotal, safeDiscountType, safeDiscountValue, discountAmount, discountPercent } =
      calcDiscount(items, discountType, discountValue);

    // ── Discount permission re-check (never trust client) ──
    if (req.user.role !== "owner" && discountAmount > 0) {
      const perm = await DiscountPermission.findOne({ userId: req.user.userId });
      if (!perm || !perm.canGiveDiscount) {
        return res.status(403).json({ error: "Aapko discount dene ki permission nahi hai" });
      }

      if (discountPercent > perm.maxDiscountPercent) {
        if (!approvalId) {
          return res.status(403).json({ error: "Is discount ke liye owner ka OTP approval chahiye" });
        }
        const request = await DiscountRequest.findById(approvalId);
        if (
          !request || request.used || !request.verified ||
          request.staffId.toString() !== req.user.userId.toString() ||
          Math.abs(request.discountAmount - discountAmount) > 1 // tamper-check
        ) {
          return res.status(403).json({ error: "Invalid ya expired discount approval" });
        }
        request.used = true;
        await request.save();
      }
    }

    const ALLOWED_STATUSES = ["Completed", "Pending", "Cancelled"];
    const orderStatus = ALLOWED_STATUSES.includes(status) ? status : "Completed";

    const taxableAmount = Math.max(0, subtotal - discountAmount);
    const safeGstRate = Math.min(100, Math.max(0, Number(gstRate) || 0));
    const gstAmount = taxableAmount * (safeGstRate / 100);
    const total = Math.round((taxableAmount + gstAmount) * 100) / 100;

    const invoiceId = `INV-${Date.now().toString().slice(-8)}`;

    for (const [idx, item] of items.entries()) {
      const escaped = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const product = await Product.findOne({ name: { $regex: `^${escaped}$`, $options: "i" } });
      if (product) {
        product.stock = Math.max(0, product.stock - Number(item.qty));
        await product.save();
      }
      const orderId = `${invoiceId}-${idx + 1}`;
      await Order.create({
        orderId, customer: customerName,
        amount: Number(item.qty) * Number(item.price),
        status: orderStatus, product: item.name, qty: Number(item.qty), date: new Date(),
      });
    }

    const invoice = new Invoice({
      invoiceId, customerName, customerEmail, customerPhone, items,
      subtotal, discountType: safeDiscountType, discountValue: safeDiscountValue,
      discountAmount, gstRate: safeGstRate, gstAmount, sellerGstin: sellerGstin || "", total,
    });
    await invoice.save();

    // ── Owner ko notification — staff ne discount diya to hamesha, khud owner ne diya to skip ──
    if (discountAmount > 0 && req.user.role !== "owner") {
      const staff = await User.findById(req.user.userId);
      await Notification.create({
        type: "discountGiven",
        shopId: req.user.shopId,
        invoiceId,
        staffName: staff?.name || "Staff",
        message: `${staff?.name || "Staff"} ne ${customerName} ke invoice (${invoiceId}) pe ₹${discountAmount.toFixed(0)} discount diya.`,
      });
    }

    if (invoice.customerPhone) {
      try {
        const pdfBuffer = generateInvoicePdfBuffer(invoice);
        await sendInvoicePdfToWhatsapp(
          pdfBuffer, invoice.customerPhone, invoice.invoiceId,
          `Hi ${invoice.customerName}, here's your invoice. Total: Rs. ${invoice.total}`
        );
      } catch (waErr) {
        console.error("⚠️ WhatsApp send failed:", waErr.response?.data || waErr.message);
      }
    }

    res.status(201).json(invoice);
  } catch (err) {
    console.error("Invoice creation error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const invoices = await Invoice.find().sort({ createdAt: -1 });
    res.json(invoices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;