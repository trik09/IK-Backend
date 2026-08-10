/**
 * One-time backfill script: populate examUsageCount on every quiz
 * by scanning all exams in the DB.
 *
 * Run once after deploying the schema change:
 *   node scripts/backfill_exam_usage_counts.js
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import QuizModel from "../models/QuizSchema.js";
import ExamModel from "../models/ExamSchema.js";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

async function backfill() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGO_URI);
  console.log("Connected.");

  const resetResult = await QuizModel.updateMany({}, { $set: { examUsageCount: 0 } });
  console.log(`Reset ${resetResult.modifiedCount} quiz counts to 0.`);

  const usageCounts = await ExamModel.aggregate([
    { $unwind: { path: "$chapters", preserveNullAndEmptyArrays: false } },
    { $unwind: { path: "$chapters.quizIds", preserveNullAndEmptyArrays: false } },
    {
      $group: {
        _id: "$chapters.quizIds",
        count: { $sum: 1 },
      },
    },
  ]);

  console.log(`Found usage data for ${usageCounts.length} quizzes. Updating...`);

  if (usageCounts.length > 0) {
    const bulkOps = usageCounts.map(({ _id, count }) => ({
      updateOne: {
        filter: { _id },
        update: { $set: { examUsageCount: count } },
      },
    }));

    const bulkResult = await QuizModel.bulkWrite(bulkOps, { ordered: false });
    console.log(`Updated ${bulkResult.modifiedCount} quiz usage counts.`);
  }

  console.log("Backfill complete.");
  await mongoose.disconnect();
}

backfill().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
