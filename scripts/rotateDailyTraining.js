import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import { rotateDailyTrainingSet } from "../utils/rotateDailyTrainingSet.js";

const run = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set.");
    process.exit(1);
  }

  await mongoose.connect(uri);
  try {
    const result = await rotateDailyTrainingSet({ force: true });
    console.log("[Daily Training] Rotation result:", result);
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((error) => {
  console.error("[Daily Training] Rotation failed:", error);
  process.exit(1);
});
