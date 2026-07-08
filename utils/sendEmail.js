const axios = require("axios");

const subjects = {
  signup: "Verify your account",
  login: "Your login code",
  reset: "Reset your password",
};

const sendOTPEmail = async (toEmail, otp, purpose = "login") => {
  await axios.post(
    "https://api.brevo.com/v3/smtp/email",
    {
      sender: { name: "Billing App", email: process.env.BREVO_SENDER_EMAIL },
      to: [{ email: toEmail }],
      subject: subjects[purpose] || "Your verification code",
      htmlContent: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Your OTP Code</h2>
          <p>This code is valid for 10 minutes:</p>
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