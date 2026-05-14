const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { sendResetPasswordEmail } = require('../services/emailService');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_development';

// SIGN UP ROUTE
router.post('/signup', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ error: 'All fields are required.' });
        }

        const existingUser = await User.findOne({ $or: [{ email }, { username }] });
        if (existingUser) {
            return res.status(400).json({ error: 'User with this email or username already exists.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new User({
            username,
            email,
            password: hashedPassword
        });

        await newUser.save();

        const token = jwt.sign({ userId: newUser._id, username: newUser.username }, JWT_SECRET, { expiresIn: '7d' });

        res.status(201).json({
            message: 'User created successfully',
            token,
            user: { 
                username: newUser.username, 
                id: newUser._id, 
                rating: newUser.rating,
                blitzRating: newUser.blitzRating,
                gamesPlayed: newUser.gamesPlayed,
                wins: newUser.wins,
                losses: newUser.losses,
                draws: newUser.draws
            }
        });

    } catch (err) {
        console.error('Signup Error:', err);
        res.status(500).json({ error: 'Registration failed.' });
    }
});

// LOGIN ROUTE
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        // Allow login with either email or username (case-insensitive)
        const user = await User.findOne({ 
            $or: [
                { email: email.toLowerCase() },
                { username: new RegExp(`^${email}$`, 'i') }
            ]
        });

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }

        const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

        res.status(200).json({
            message: 'Logged in successfully',
            token,
            user: { 
                username: user.username, 
                id: user._id, 
                rating: user.rating,
                blitzRating: user.blitzRating,
                gamesPlayed: user.gamesPlayed,
                wins: user.wins,
                losses: user.losses,
                draws: user.draws
            }
        });

    } catch (err) {
        console.error('Login Error:', err);
        res.status(500).json({ error: 'Login failed.' });
    }
});

// GET CURRENT USER PROFILE
router.get('/me', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        const user = await User.findById(decoded.userId).select('-password');
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.status(200).json(user);
    } catch (err) {
        console.error('Auth Error:', err);
        res.status(401).json({ error: 'Invalid token' });
    }
});

// ADMIN: GET ALL USERS
router.get('/users', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
        
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        
        const admin = await User.findById(decoded.userId);
        if (!admin || admin.role !== 'admin') {
            return res.status(403).json({ error: 'Access denied. Admins only.' });
        }

        const users = await User.find().select('-password').sort({ createdAt: -1 });
        res.status(200).json(users);
    } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ error: 'Failed to fetch users', details: err.message });
    }
});

// ADMIN: DELETE USER
router.delete('/users/:id', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
        
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        
        const admin = await User.findById(decoded.userId);
        if (!admin || admin.role !== 'admin') {
            return res.status(403).json({ error: 'Access denied. Admins only.' });
        }

        await User.findByIdAndDelete(req.params.id);
        res.status(200).json({ message: 'User deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

// FORGOT PASSWORD
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            // Don't reveal if user exists for security, just send success
            return res.status(200).json({ message: 'If an account exists with that email, a reset link has been sent.' });
        }

        // Generate token
        const resetToken = crypto.randomBytes(32).toString('hex');
        user.resetPasswordToken = resetToken;
        user.resetPasswordExpires = Date.now() + 3600000; // 1 hour

        await user.save();

        // Send Email
        await sendResetPasswordEmail(user.email, resetToken, user.username);

        res.status(200).json({ message: 'If an account exists with that email, a reset link has been sent.' });
    } catch (err) {
        console.error('Forgot Password Error:', err);
        res.status(500).json({ error: 'Failed to process request.' });
    }
});

// RESET PASSWORD
router.post('/reset-password/:token', async (req, res) => {
    try {
        const { password } = req.body;
        const { token } = req.params;

        if (!password) return res.status(400).json({ error: 'New password is required' });

        const user = await User.findOne({
            resetPasswordToken: token,
            resetPasswordExpires: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({ error: 'Invalid or expired reset token.' });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(password, 10);
        user.password = hashedPassword;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;

        await user.save();

        res.status(200).json({ message: 'Password has been reset successfully. You can now log in.' });
    } catch (err) {
        console.error('Reset Password Error:', err);
        res.status(500).json({ error: 'Failed to reset password.' });
    }
});

module.exports = router;
