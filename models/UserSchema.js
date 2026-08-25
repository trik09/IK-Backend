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
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },

    puzzleRating: { type: Number, default: 400 },
    puzzleRD: { type: Number, default: 350 },
    puzzleVolatility: { type: Number, default: 0.06 },
    puzzleAttemptsCount: { type: Number, default: 0 },
    puzzleSolvedCount: { type: Number, default: 0 },
    puzzleFailedCount: { type: Number, default: 0 },
    highestPuzzleStreak: { type: Number, default: 0 },
    currentPuzzleStreak: { type: Number, default: 0 },
    lastRatedPuzzleAt: { type: Date },

    // Refresh token — hashed for security, rotated on every use
    refreshToken: { type: String, default: null },
    refreshTokenExpiry: { type: Date, default: null },

    createdAt: { type: Date, default: Date.now }
});



const userModel = mongoose.model("User", UserSchema)

export default userModel