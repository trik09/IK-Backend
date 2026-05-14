const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

const sendResetPasswordOTP = async (email, otp, username) => {
    const mailOptions = {
        from: `"Indian Knights" <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'Password Reset OTP - Indian Knights',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                <h2 style="color: #6366f1; text-align: center;">Indian Knights</h2>
                <p>Hello ${username},</p>
                <p>You requested to reset your password. Use the OTP below to verify your identity. This OTP will expire in 10 minutes.</p>
                <div style="text-align: center; margin: 30px 0;">
                    <span style="font-size: 32px; font-weight: bold; letter-spacing: 10px; color: #6366f1; background: #f4f4f5; padding: 10px 20px; border-radius: 5px;">${otp}</span>
                </div>
                <p>If you did not request this, please ignore this email.</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
                <p style="font-size: 12px; color: #777;">Indian Knights Chess Platform</p>
            </div>
        `
    };

    return transporter.sendMail(mailOptions);
};

module.exports = {
    sendResetPasswordOTP
};
