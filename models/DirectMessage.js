const mongoose = require('mongoose');

const DirectMessageSchema = new mongoose.Schema({
    senderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    receiverId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    text: {
        type: String,
        default: ''
    },
    type: {
        type: String,
        enum: ['text', 'challenge'],
        default: 'text'
    },
    challengeData: {
        roomCode: String,
        timeControl: {
            minutes: Number,
            increment: Number
        },
        status: {
            type: String,
            enum: ['pending', 'accepted', 'declined', 'expired'],
            default: 'pending'
        }
    },
    read: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

// Create an index to quickly fetch conversations between two users
DirectMessageSchema.index({ senderId: 1, receiverId: 1 });

module.exports = mongoose.model('DirectMessage', DirectMessageSchema);
