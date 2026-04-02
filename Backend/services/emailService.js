const RESEND_API_URL = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 15000;

function buildOtpHtml(otp) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 400px; margin: 0 auto; padding: 20px; background: #0a0a0f; color: #fff; border-radius: 12px;">
      <h2 style="color: #00ff88; text-align: center;">SecureChat</h2>
      <p>Your one-time password is:</p>
      <div style="background: #1a1a2e; padding: 20px; border-radius: 8px; text-align: center;">
        <h1 style="color: #00ff88; letter-spacing: 8px; font-size: 36px; margin: 0;">${otp}</h1>
      </div>
      <p style="color: #666; font-size: 12px;">This OTP expires in 5 minutes. Do not share it.</p>
    </div>
  `;
}

async function sendWithResend(email, otp) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  if (!from) {
    throw new Error("EMAIL_FROM is not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "Your SecureChat OTP Code",
        html: buildOtpHtml(otp),
      }),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const details = data?.message || data?.error || response.statusText;
      throw new Error(`Resend request failed: ${details}`);
    }

    console.log("Email sent successfully via Resend");
  } finally {
    clearTimeout(timeout);
  }
}

const sendEmail = async (email, otp) => {
  try {
    await sendWithResend(email, otp);
  } catch (error) {
    console.error("Email sending failed:", error);
    throw new Error("Email delivery failed");
  }
};

module.exports = sendEmail;