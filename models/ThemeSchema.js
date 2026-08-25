import mongoose from "mongoose";

const ThemeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  slug: {
    type: String,
    trim: true,
    lowercase: true
  },
  displayOrder: {
    type: Number,
    default: 0
  },
  title: {
    type: String,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  icon: {
    type: String,
    default: "FaChess"
  },
  puzzles: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Puzzle"
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin"
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

// Update the updatedAt timestamp before saving
ThemeSchema.pre('save', function () {
  this.updatedAt = Date.now();
});

// Index for faster queries
ThemeSchema.index({ name: 1, isActive: 1 });

const ThemeModel = mongoose.model("Theme", ThemeSchema);

export default ThemeModel;
