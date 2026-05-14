const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true,
    },
    password: {
        type: String,
        required: true,
    },
    rating: {
        type: Number,
        default: 1200,
    },
    blitzRating: {
        type: Number,
        default: 1200,
    },
    rapidRating: {
        type: Number,
        default: 1200,
    },
    bulletRating: {
        type: Number,
        default: 1200,
    },
    classicalRating: {
        type: Number,
        default: 1200,
    },
    gamesPlayed: {
        type: Number,
        default: 0,
    },
    wins: {
        type: Number,
        default: 0,
    },
    losses: {
        type: Number,
        default: 0,
    },
    draws: {
        type: Number,
        default: 0,
    },
    friends: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    friendRequests: [{
        from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
        createdAt: { type: Date, default: Date.now }
    }],
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user'
    },
    resetPasswordToken: String,
    resetPasswordExpires: Date
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);
