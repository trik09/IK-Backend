import mongoose from "mongoose";

const quoteSchema = new mongoose.Schema({
    quote: {
        type: String,
        required: true
    },
    author: {
        type: String,
        default: "Anonymous"
    },
    isActive: {
        type: Boolean,
        default: false
    },
    displayDate: {
        type: Date,
        default: null
    },
    no: {
        type: Number,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

quoteSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

export default mongoose.model("Quote", quoteSchema);