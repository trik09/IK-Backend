import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    username: { type: String, unique: true },
    email: { type: String, unique: true },
    password: String,
    avatar: String,
    googleId: { type: String, sparse: true },
    authProvider: { type: String, enum: ['local', 'google'], default: 'local' },

    // Chess & Puzzle Ratings
    rating: { type: Number, default: 1200 },
    playingRating: { type: Number, default: 1000 },
    playingGamesCount: { type: Number, default: 0 },
    playingWinsCount: { type: Number, default: 0 },
    playingLossesCount: { type: Number, default: 0 },
    playingDrawsCount: { type: Number, default: 0 },

    puzzleRating: { type: Number, default: 1000 },
    puzzleAttemptsCount: { type: Number, default: 0 },
    puzzleSolvedCount: { type: Number, default: 0 },
    puzzleFailedCount: { type: Number, default: 0 },

    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    draws: { type: Number, default: 0 },

    // ── QCFY Pro Membership ──────────────────────────────────────────────
    membership: {
        plan: { type: String, enum: ["free", "pro"], default: "free" },
        activatedAt: { type: Date, default: null },
        expiresAt: { type: Date, default: null },       // null = lifetime
        status: { type: String, enum: ["active", "expired", "cancelled"], default: "active" },
        provider: { type: String, enum: ["simulated", "stripe", "razorpay", "cashfree"], default: "simulated" },
        orderId: { type: String, default: null },        // Payment gateway reference
        history: [{
            plan: String,
            provider: String,
            orderId: String,
            activatedAt: Date,
            expiresAt: Date,
            cancelledAt: Date,
        }],
    },

    // ── Gamification ─────────────────────────────────────────────────────
    xp: { type: Number, default: 0 },
    learningStreak: {
        current: { type: Number, default: 0 },
        best: { type: Number, default: 0 },
        lastActiveDate: { type: Date, default: null },
    },

    // Refresh token — hashed for security, rotated on every use
    refreshToken: { type: String, default: null },
    refreshTokenExpiry: { type: Date, default: null },

    createdAt: { type: Date, default: Date.now }
});

const userModel = mongoose.model("User", UserSchema);

export default userModel;