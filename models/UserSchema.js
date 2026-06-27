import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    username: { type: String, unique: true },
    email: { type: String, unique: true },
    password: String,
    avatar: String,
    googleId: { type: String, sparse: true },
    authProvider: { type: String, enum: ['local', 'google'], default: 'local' },

    rating: { type: Number, default: 1200 },
    puzzleRating: { type: Number, default: 1000 },
    puzzleRatingAttempts: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },

    // Refresh token — hashed for security, rotated on every use
    refreshToken: { type: String, default: null },
    refreshTokenExpiry: { type: Date, default: null },

    createdAt: { type: Date, default: Date.now }
});



const userModel = mongoose.model("User", UserSchema)

export default userModel