import mongoose from "mongoose";
import dotenv from "dotenv";
import EventModel from "../models/EventSchema.js";

dotenv.config();

async function dumpEvents() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/quickchess");
    console.log("Connected to MongoDB");

    const events = await EventModel.find().lean();
    console.log("Events:", JSON.stringify(events, null, 2));

    await mongoose.disconnect();
  } catch (error) {
    console.error("Error:", error);
  }
}

dumpEvents();
