import mongoose from "mongoose";

const RaceParticipantSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  username: { type: String, default: "Racer" },
  name: { type: String, default: "" },
  avatar: { type: String, default: null },
  vehicle: {
    id: { type: String, default: "supercar" },
    name: { type: String, default: "Supercar" },
    color: { type: String, default: "#ef4444" },
  },
  meters: { type: Number, default: 0 },
  speed: { type: Number, default: 0 }, // km/h representation
  combo: { type: Number, default: 0 },
  maxCombo: { type: Number, default: 0 },
  puzzlesSolved: { type: Number, default: 0 },
  mistakes: { type: Number, default: 0 },
  skipsUsed: { type: Number, default: 0 },
  currentPuzzleIndex: { type: Number, default: 0 },
  finishedAt: { type: Date, default: null },
  joinedAt: { type: Date, default: Date.now },
}, { _id: false });

const RaceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    default: "",
  },
  startTime: {
    type: Date,
    required: true,
  },
  endTime: {
    type: Date,
    required: true,
  },
  duration: {
    type: Number,
    required: true,
    default: 90, // duration in seconds
  },
  countdownDuration: {
    type: Number,
    default: 10, // 10-second traffic light countdown
  },
  status: {
    type: String,
    enum: ["UPCOMING", "LIVE", "ENDED"],
    default: "UPCOMING",
  },
  category: {
    type: String,
    default: "All",
  },
  puzzles: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Puzzle",
  }],
  participants: [RaceParticipantSchema],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Admin",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

RaceSchema.pre("save", function () {
  this.updatedAt = Date.now();
});

RaceSchema.index({ status: 1, startTime: 1 });
RaceSchema.index({ status: 1, endTime: 1 });
RaceSchema.index({ "participants.user": 1 });

const RaceModel = mongoose.model("Race", RaceSchema);

export default RaceModel;
