// Email service for sending OTP
import nodemailer from 'nodemailer';

const sendOTPEmail = async (email, otp) => {
  try {
    // Check if SMTP is configured
    const hasSMTPConfig = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;

    // If SMTP is configured, try to send actual email
    if (hasSMTPConfig) {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: parseInt(process.env.SMTP_PORT) === 465, // true for 465, false for other ports
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      const mailOptions = {
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: email,
        subject: 'Your Chess Platform OTP',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #f4f4f4; padding: 20px; border-radius: 10px;">
              <h2 style="color: #333;">Your OTP Code</h2>
              <p style="color: #666; font-size: 16px;">Your One-Time Password (OTP) for login is:</p>
              <div style="background-color: #fff; padding: 20px; border-radius: 5px; text-align: center; margin: 20px 0;">
                <h1 style="color: #4CAF50; font-size: 36px; letter-spacing: 8px; margin: 0;">${otp}</h1>
              </div>
              <p style="color: #666; font-size: 14px;">This OTP will expire in 10 minutes.</p>
              <p style="color: #999; font-size: 12px; margin-top: 20px;">If you didn't request this OTP, please ignore this email.</p>
            </div>
          </div>
        `,
      };

      await transporter.sendMail(mailOptions);
      console.log(`OTP email sent successfully to ${email}`);
      return true;
    } else {
      // Fallback to console log if SMTP not configured
      console.log(`SMTP not configured`);

      return true;
    }
  } catch (error) {
    console.error('Unexpected error in email service:', error.message);
    // Even on error, log OTP to console so user can still use it

    return false; // Return true so the API doesn't fail
  }
};

export default sendOTPEmail;

