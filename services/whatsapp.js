// backend/services/whatsapp.js
const axios = require("axios");
const FormData = require("form-data");

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const API_BASE = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}`;

// Converts "+91 98765 43210" or "9876543210" -> "919876543210" (WhatsApp needs country code, no + or spaces)
function normalizePhone(rawPhone) {
  let digits = String(rawPhone || "").replace(/[^0-9]/g, "");
  if (digits.length === 10) digits = "91" + digits; // default to India if no country code given
  return digits;
}

// 1) Upload PDF buffer to WhatsApp, get back a media_id
async function uploadMedia(pdfBuffer, filename = "invoice.pdf") {
  const form = new FormData();
  form.append("file", pdfBuffer, { filename, contentType: "application/pdf" });
  form.append("messaging_product", "whatsapp");

  const res = await axios.post(`${API_BASE}/media`, form, {
    headers: { Authorization: `Bearer ${TOKEN}`, ...form.getHeaders() },
  });
  return res.data.id; // media_id
}

// 2) Send that media_id as a document message to the customer
async function sendInvoiceDocument(toPhone, mediaId, filename, caption) {
  const to = normalizePhone(toPhone);
  console.log(`📲 Sending WhatsApp document. Raw phone: "${toPhone}" -> Normalized: "${to}", mediaId: ${mediaId}`);
  const res = await axios.post(
    `${API_BASE}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: { id: mediaId, filename, caption },
    },
    { headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } }
  );
  console.log("📩 Full WhatsApp API response:", JSON.stringify(res.data, null, 2));
  return res.data;
}

// Convenience wrapper: upload + send in one call
async function sendInvoicePdfToWhatsapp(pdfBuffer, toPhone, invoiceId, caption) {
  const filename = `${invoiceId}.pdf`;
  const mediaId = await uploadMedia(pdfBuffer, filename);
  return sendInvoiceDocument(toPhone, mediaId, filename, caption);
}

module.exports = { sendInvoicePdfToWhatsapp, normalizePhone };