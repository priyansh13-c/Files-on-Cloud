const { BrevoClient } = require("@getbrevo/brevo");
const dotenv = require("dotenv");
dotenv.config();

const brevo = new BrevoClient({
  apiKey: process.env.BREVO_API_KEY,
});


const sendEmail = async ({ toEmail, subject, htmlContent }) => {
  try {
    const response = await brevo.transactionalEmails.sendTransacEmail({
      sender: {
        name: process.env.BREVO_SENDER_NAME,
        email: process.env.BREVO_SENDER_EMAIL,
      },
      to: [{ email: toEmail }],
      subject,
      htmlContent,
    });

    console.log("Email sent:", response);
    return response;
  } catch (error) {
    console.error("Brevo Email Error:", error?.message || error);
    throw error;
  }
};

module.exports = sendEmail;