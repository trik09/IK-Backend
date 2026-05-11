import mongoose from "mongoose";
import dotenv from "dotenv";
import EventModel from "../models/EventSchema.js";

dotenv.config();

async function updateEvent() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/quickchess");
    console.log("Connected to MongoDB");

    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const result = await EventModel.findByIdAndUpdate(
      "69f13463353d4cc0f9d6b2da",
      {
        status: "LIVE",
        isActive: true,
        startTime: now,
        endTime: tomorrow,
      },
      { new: true }
    );

    console.log("Updated Event:", result);

    await mongoose.disconnect();
  } catch (error) {
    console.error("Error:", error);
  }
}

updateEvent();
