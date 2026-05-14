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

const sendResetPasswordEmail = async (email, resetToken, username) => {
    // The link should point to your frontend
    const resetUrl = `${process.env.FRONTEND_URL || 'https://chessknight.in'}/reset-password/${resetToken}`;

    const mailOptions = {
        from: `"Indian Knights" <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'Password Reset Request - Indian Knights',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                <h2 style="color: #6366f1; text-align: center;">Indian Knights</h2>
                <p>Hello ${username},</p>
                <p>You requested to reset your password. Please click the button below to set a new password. This link will expire in 1 hour.</p>
                <div style="text-align: center; margin: 30px 0;">
                    <a href="${resetUrl}" style="background-color: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a>
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
    sendResetPasswordEmail
};
