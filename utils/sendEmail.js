const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // Gmail App Password (16-digit), normal password nahi chalega
  },
});

const sendVerificationEmail = async (toEmail, verifyLink) => {
  await transporter.sendMail({
    from: `"Billing App" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: "Verify your email",
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>Verify your email</h2>
        <p>Account activate karne ke liye niche diye link pe click karo. Link 24 hours valid hai.</p>
        <a href="${verifyLink}" style="display:inline-block;padding:10px 20px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:6px;">
          Verify Email
        </a>
        <p>Agar button kaam na kare, is link ko copy karke browser me paste karo:</p>
        <p>${verifyLink}</p>
      </div>
    `,
  });
};

module.exports = sendVerificationEmail;