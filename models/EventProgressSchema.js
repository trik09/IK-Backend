import mongoose from "mongoose";

const EventProgressSchema = new mongoose.Schema({
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Event",
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  completedRounds: [{
    roundId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EventRound"
    },
    completedAt: {
      type: Date,
      default: Date.now
    },
    score: {
      type: Number,
      default: 0
    }
  }],
  currentRoundIndex: {
    type: Number,
    default: 0
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

EventProgressSchema.index({ eventId: 1, userId: 1 }, { unique: true });

const EventProgressModel = mongoose.model("EventProgress", EventProgressSchema);
export default EventProgressModel;
