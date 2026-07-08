const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

const sendOTPEmail = async (toEmail, otp) => {
  await resend.emails.send({
    from: "Billing App <onboarding@resend.dev>",
    to: toEmail,
    subject: "Your verification code",
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>Your OTP Code</h2>
        <p>Yeh code 10 minutes ke liye valid hai:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #4f46e5; margin: 16px 0;">
          ${otp}
        </div>
        <p>Agar tumne yeh request nahi ki, is email ko ignore karo.</p>
      </div>
    `,
  });
};

module.exports = sendOTPEmail;