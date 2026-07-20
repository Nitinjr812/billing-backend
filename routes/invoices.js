const express = require("express");
const router = express.Router();
const Invoice = require("../models/Invoice");
const Product = require("../models/Product");
const Order = require("../models/Order");
const { generateInvoicePdfBuffer } = require("../utils/generateInvoicePdf");
const { sendInvoicePdfToWhatsapp } = require("../services/whatsapp");

// POST /api/invoices — create invoice + auto-decrement stock + create real orders
router.post("/", async (req, res) => {
  try {
    const {
      customerName,
      customerEmail,
      customerPhone,
      items,
      status,
      discountType,
      discountValue,
      gstRate,
      sellerGstin,
    } = req.body;

    if (!customerName || !items || !items.length) {
      return res.status(400).json({ error: "Customer name and items are required" });
    }

    // Only allow known statuses; default to "Completed" for offline/in-person sales.
    const ALLOWED_STATUSES = ["Completed", "Pending", "Cancelled"];
    const orderStatus = ALLOWED_STATUSES.includes(status) ? status : "Completed";

    // ── Pricing calculation — ALWAYS done server-side, never trust client math ──
    const subtotal = items.reduce(
      (sum, it) => sum + (Number(it.qty) || 0) * (Number(it.price) || 0),
      0
    );

    const safeDiscountType = discountType === "percentage" ? "percentage" : "flat";
    const safeDiscountValue = Math.max(0, Number(discountValue) || 0);

    let discountAmount = 0;
    if (safeDiscountType === "percentage") {
      const clampedPct = Math.min(100, safeDiscountValue);
      discountAmount = subtotal * (clampedPct / 100);
    } else {
      discountAmount = Math.min(subtotal, safeDiscountValue);
    }

    const taxableAmount = Math.max(0, subtotal - discountAmount);

    const safeGstRate = Math.min(100, Math.max(0, Number(gstRate) || 0));
    const gstAmount = taxableAmount * (safeGstRate / 100);

    const total = Math.round((taxableAmount + gstAmount) * 100) / 100;

    // Unique invoice ID — timestamp based, no race conditions
    const invoiceId = `INV-${Date.now().toString().slice(-8)}`;

    // Decrement stock for matching products (case-insensitive name match)
    // and create a real Order document per item, so the Orders page and
    // Dashboard reflect this invoice immediately.
    for (const [idx, item] of items.entries()) {
      const escaped = item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const product = await Product.findOne({ name: { $regex: `^${escaped}$`, $options: "i" } });

      if (product) {
        product.stock = Math.max(0, product.stock - Number(item.qty));
        await product.save();
      }

      const orderId = `${invoiceId}-${idx + 1}`;
      await Order.create({
        orderId,
        customer: customerName,
        amount: Number(item.qty) * Number(item.price),
        status: orderStatus,
        product: item.name,
        qty: Number(item.qty),
        date: new Date(),
      });
    }

    const invoice = new Invoice({
      invoiceId,
      customerName,
      customerEmail,
      customerPhone,
      items,
      subtotal,
      discountType: safeDiscountType,
      discountValue: safeDiscountValue,
      discountAmount,
      gstRate: safeGstRate,
      gstAmount,
      sellerGstin: sellerGstin || "",
      total,
    });

    await invoice.save();

    // ── WhatsApp send — MUST be awaited before responding.
    // Serverless functions (Vercel) freeze/kill the process right after the
    // response is sent, so any "fire and forget" code after res.json() may
    // never actually finish running. We await it here instead, and wrap in
    // try/catch so a WhatsApp failure never breaks invoice creation itself.
    if (invoice.customerPhone) {
      try {
        const pdfBuffer = generateInvoicePdfBuffer(invoice);
        await sendInvoicePdfToWhatsapp(
          pdfBuffer,
          invoice.customerPhone,
          invoice.invoiceId,
          `Hi ${invoice.customerName}, here's your invoice. Total: Rs. ${invoice.total}`
        );
        console.log(`✅ Invoice ${invoice.invoiceId} sent on WhatsApp to ${invoice.customerPhone}`);
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

// GET /api/invoices — list all past invoices
router.get("/", async (req, res) => {
  try {
    const invoices = await Invoice.find().sort({ createdAt: -1 });
    res.json(invoices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;