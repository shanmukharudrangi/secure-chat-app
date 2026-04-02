const twilio = require("twilio");

const sendSMS = async (phone, otp) => {
  try {
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    await client.messages.create({
      body: `Your SecureChat OTP is: ${otp}. Valid for 5 minutes.`,
      from: process.env.TWILIO_PHONE,
      to: phone
    });
    console.log("SMS sent successfully");
  } catch (error) {
    console.error("SMS sending failed:", error);
    throw new Error("SMS delivery failed");
  }
};

module.exports = sendSMS;
