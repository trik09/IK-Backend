const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('../models/User');
require('dotenv').config();

const seedAdmin = async () => {
    const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/indian_knights';
    
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB...');

        const email = 'admin@gmail.com';
        const password = 'admin@6163';
        const username = 'SystemAdmin';

        // Check if user exists
        let user = await User.findOne({ email });

        if (user) {
            console.log('Admin user already exists. Updating password and role...');
            const hashedPassword = await bcrypt.hash(password, 10);
            user.password = hashedPassword;
            user.role = 'admin';
            user.username = username;
            await user.save();
        } else {
            console.log('Creating new admin user...');
            const hashedPassword = await bcrypt.hash(password, 10);
            user = new User({
                username,
                email,
                password: hashedPassword,
                role: 'admin'
            });
            await user.save();
        }

        console.log('✅ Admin account ready:');
        console.log(`Email: ${email}`);
        console.log(`Password: ${password}`);
        
        process.exit(0);
    } catch (err) {
        console.error('Error seeding admin:', err);
        process.exit(1);
    }
};

seedAdmin();
