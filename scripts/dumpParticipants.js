import mongoose from "mongoose";
import dotenv from "dotenv";
import EventParticipantModel from "../models/EventParticipantSchema.js";

dotenv.config();

async function dumpParticipants() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/quickchess");
    console.log("Connected to MongoDB");

    const participants = await EventParticipantModel.find({ eventId: "69f13463353d4cc0f9d6b2da" }).lean();
    console.log("Participants:", JSON.stringify(participants, null, 2));

    await mongoose.disconnect();
  } catch (error) {
    console.error("Error:", error);
  }
}

dumpParticipants();
