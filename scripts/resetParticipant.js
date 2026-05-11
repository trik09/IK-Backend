import mongoose from "mongoose";
import dotenv from "dotenv";
import EventParticipantModel from "../models/EventParticipantSchema.js";
import PuzzleAttemptModel from "../models/PuzzleAttemptSchema.js";

dotenv.config();

async function resetParticipant() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/quickchess");
    console.log("Connected to MongoDB");

    const result = await EventParticipantModel.findByIdAndUpdate(
      "69f13475353d4cc0f9d6b305",
      {
        status: "JOINED",
        score: 0,
        puzzlesSolved: 0,
        timeSpent: 0,
        isSubmitted: false,
        submittedAt: null,
        isActive: true,
      },
      { new: true }
    );

    console.log("Reset Participant:", result);

    // Also clear puzzle attempts
    const delResult = await PuzzleAttemptModel.deleteMany({
      competitionId: "69f13463353d4cc0f9d6b2da",
      userId: "697b13b81c468af778671311"
    });
    console.log("Deleted attempts:", delResult);

    await mongoose.disconnect();
  } catch (error) {
    console.error("Error:", error);
  }
}

resetParticipant();
