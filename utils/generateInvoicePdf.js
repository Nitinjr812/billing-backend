// backend/utils/generateInvoicePdf.js
const { jsPDF } = require("jspdf");
const autoTable = require("jspdf-autotable").default;
const fs = require("fs");
const path = require("path");

const BRAND = {
  name: "Draftbill",
  tagline: "Invoicing, made simple",
  accentRGB: [37, 99, 235],
  darkRGB: [17, 24, 39],
  grayRGB: [107, 114, 128],
  lightBgRGB: [245, 247, 250],
};

// Read the logo once from disk and cache its base64 form — jsPDF's addImage()
// needs base64 data, not a file path.
let cachedLogoBase64 = null;
function getLogoBase64() {
  if (cachedLogoBase64 !== null) return cachedLogoBase64;
  try {
    const logoPath = path.join(__dirname, "..", "assets", "logo.png");
    const fileBuffer = fs.readFileSync(logoPath);
    cachedLogoBase64 = `data:image/png;base64,${fileBuffer.toString("base64")}`;
  } catch (e) {
    console.error("⚠️ Could not load logo for PDF:", e.message);
    cachedLogoBase64 = false; // false = "tried and failed", so we don't retry every time
  }
  return cachedLogoBase64;
}

// Same visual design as your frontend downloadInvoicePDF(), just returns a Buffer instead of triggering a browser download
function generateInvoicePdfBuffer(invoice) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const date = new Date(invoice.createdAt || Date.now()).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });

  doc.setFillColor(...BRAND.darkRGB);
  doc.rect(0, 0, pageWidth, 38, "F");

  const logoBase64 = getLogoBase64();

  if (logoBase64) {
    doc.addImage(logoBase64, margin, 9, 20, 20);
  } else {
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(0.6);
    doc.roundedRect(margin, 9, 20, 20, 3, 3);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text("DB", margin + 10, 21, { align: "center" });
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text(BRAND.name, margin + 26, 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(200, 205, 215);
  doc.text(BRAND.tagline, margin + 26, 25);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(255, 255, 255);
  doc.text("INVOICE", pageWidth - margin, 20, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(200, 205, 215);
  doc.text(`#${invoice.invoiceId}`, pageWidth - margin, 27, { align: "right" });

  let y = 52;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...BRAND.grayRGB);
  doc.text("BILLED TO", margin, y);
  doc.text("INVOICE DATE", pageWidth - margin, y, { align: "right" });

  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...BRAND.darkRGB);
  doc.text(invoice.customerName, margin, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(date, pageWidth - margin, y, { align: "right" });

  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...BRAND.grayRGB);
  if (invoice.customerEmail) { doc.text(invoice.customerEmail, margin, y); y += 5; }
  if (invoice.customerPhone) { doc.text(invoice.customerPhone, margin, y); y += 5; }

  y += 4;
  doc.setDrawColor(230, 230, 235);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);

  const tableRows = invoice.items.map((it) => [
    it.name,
    String(it.qty),
    `Rs. ${Number(it.price).toLocaleString("en-IN")}`,
    `Rs. ${(Number(it.qty) * Number(it.price)).toLocaleString("en-IN")}`,
  ]);

  autoTable(doc, {
    startY: y + 8,
    head: [["Item", "Qty", "Price", "Amount"]],
    body: tableRows,
    theme: "plain",
    styles: { fontSize: 10, cellPadding: { top: 6, bottom: 6, left: 4, right: 4 }, textColor: BRAND.darkRGB },
    headStyles: { fillColor: BRAND.darkRGB, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 9 },
    alternateRowStyles: { fillColor: BRAND.lightBgRGB },
    columnStyles: { 1: { halign: "center" }, 2: { halign: "right" }, 3: { halign: "right" } },
  });

  const finalY = doc.lastAutoTable.finalY + 8;
  const boxW = 70;
  const boxX = pageWidth - margin - boxW;

  doc.setFillColor(...BRAND.lightBgRGB);
  doc.roundedRect(boxX, finalY, boxW, 18, 2, 2, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...BRAND.grayRGB);
  doc.text("Total Amount", boxX + 6, finalY + 8);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...BRAND.accentRGB);
  doc.text(`Rs. ${Number(invoice.total).toLocaleString("en-IN")}`, boxX + boxW - 6, finalY + 13, { align: "right" });

  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setDrawColor(230, 230, 235);
  doc.line(margin, pageHeight - 20, pageWidth - margin, pageHeight - 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...BRAND.grayRGB);
  doc.text("Thank you for your business!", margin, pageHeight - 13);
  doc.text(`Generated by ${BRAND.name}`, pageWidth - margin, pageHeight - 13, { align: "right" });

  // Return as Node Buffer instead of saving/downloading
  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}

module.exports = { generateInvoicePdfBuffer };