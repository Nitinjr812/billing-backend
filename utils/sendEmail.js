const axios = require("axios");

const sendOTPEmail = async (toEmail, otp) => {
  await axios.post(
    "https://api.brevo.com/v3/smtp/email",
    {
      sender: { name: "Billing App", email: process.env.BREVO_SENDER_EMAIL }, // wahi email jo verify kiya
      to: [{ email: toEmail }],
      subject: "Your verification code",
      htmlContent: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Your OTP Code</h2>
          <p>Yeh code 10 minutes ke liye valid hai:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #4f46e5; margin: 16px 0;">
            ${otp}
          </div>
          <p>Agar tumne yeh request nahi ki, is email ko ignore karo.</p>
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