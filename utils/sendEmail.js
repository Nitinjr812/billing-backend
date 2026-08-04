const axios = require("axios");

const subjects = {
  signup: "Verify your account",
  login: "Your login code",
  reset: "Reset your password",
  "discount-approval": "Discount approval needed — OTP inside",
};

// meta (optional, 4th param): extra context for richer templates,
// e.g. { staffName, customerName, discountAmount } for discount-approval.
const sendOTPEmail = async (toEmail, otp, purpose = "login", meta = {}) => {
  const isDiscountApproval = purpose === "discount-approval";

  const contextBlock = isDiscountApproval
    ? `
        <p style="margin: 0 0 12px; color: #374151;">
          <strong>${meta.staffName || "A staff member"}</strong> is trying to give a discount of
          <strong>₹${Number(meta.discountAmount || 0).toLocaleString("en-IN")}</strong>
          ${meta.customerName ? `on an invoice for <strong>${meta.customerName}</strong>` : ""},
          which is above their allowed limit.
        </p>
        <p style="margin: 0 0 12px; color: #374151;">
          Share this code with them only if you approve this discount:
        </p>
      `
    : `<p>This code is valid for 10 minutes:</p>`;

  await axios.post(
    "https://api.brevo.com/v3/smtp/email",
    {
      sender: { name: "Billing App", email: process.env.BREVO_SENDER_EMAIL },
      to: [{ email: toEmail }],
      subject: subjects[purpose] || "Your verification code",
      htmlContent: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>${isDiscountApproval ? "Discount Approval Request" : "Your OTP Code"}</h2>
          ${contextBlock}
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #4f46e5; margin: 16px 0;">
            ${otp}
          </div>
          <p>If you didn't request this, please ignore this email.</p>
        </div>
      `,
    },
    {
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json",
      },
    }
  );
};

module.exports = sendOTPEmail;