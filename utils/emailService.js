import nodemailer from 'nodemailer';
import { Resend } from 'resend';

// Lazy initialization - create Resend instance only when needed
let resend = null;

const getResendClient = () => {
  if (!resend) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      // No Resend API key configured
      return null;
    }
    resend = new Resend(apiKey);
  }
  return resend;
};

const sendOTPEmail = async (email, otp) => {
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
      <div style="background-color: #f4f4f4; padding: 20px; border-radius: 10px;">
        <h2 style="color: #333;">Your OTP Code</h2>
        <p style="color: #666; font-size: 16px;">
          Your One-Time Password (OTP) for login is:
        </p>
        <div style="
          background-color: #fff;
          padding: 20px;
          border-radius: 5px;
          text-align: center;
          margin: 20px 0;
        ">
          <h1 style="
            color: #4CAF50;
            font-size: 36px;
            letter-spacing: 8px;
            margin: 0;
          ">
            ${otp}
          </h1>
        </div>
        <p style="color: #666; font-size: 14px;">
          This OTP will expire in 10 minutes.
        </p>
        <p style="
          color: #999;
          font-size: 12px;
          margin-top: 20px;
        ">
          If you didn't request this OTP, please ignore this email.
        </p>
      </div>
    </div>
  `;

  try {
    const resendClient = getResendClient();
    
    if (resendClient) {
      console.log('📧 Attempting to send OTP email via Resend...');
      const response = await resendClient.emails.send({
        from: process.env.SMTP_FROM || 'support@quickchessforyou.com',
        to: email,
        subject: 'Your Chess Platform OTP',
        html: htmlContent,
      });
      
      if (response && response.data !== null) {
        console.log('✅ OTP email sent successfully via Resend');
        return true;
      }
      throw new Error('Resend returned an empty response or error');
    }

    // Fallback to Nodemailer SMTP
    const hasSMTPConfig = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;
    if (hasSMTPConfig) {
      console.log('📧 Attempting to send OTP email via Nodemailer SMTP...');
      
      const secure = process.env.SMTP_SECURE === 'true' || parseInt(process.env.SMTP_PORT) === 465;
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: secure,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      const mailOptions = {
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: email,
        subject: 'Your Chess Platform OTP',
        html: htmlContent,
      };

      await transporter.sendMail(mailOptions);
      console.log(`✅ OTP email sent successfully to ${email} via Nodemailer`);
      return true;
    }

    // If neither is configured, fallback to console log (mainly for local development/offline testing)
    console.warn('⚠️ Neither RESEND_API_KEY nor SMTP configuration is present.');
    console.log(`[DEVELOPMENT FALLBACK] OTP for ${email} is: ${otp}`);
    return true; // Return true so that development testing is not blocked
  } catch (error) {
    console.error('❌ Email service error:', error);
    
    // Even if sending fails, in development we log the OTP so the user is not blocked
    console.log(`[DEVELOPMENT FALLBACK] OTP for ${email} is: ${otp}`);
    
    // Return true in development to allow the flow to proceed, but false otherwise
    const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
    return isDev;
  }
};

export default sendOTPEmail;
