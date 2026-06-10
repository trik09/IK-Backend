/**
 * One-time backfill script: populate competitionUsageCount on every puzzle
 * by scanning all competitions in the DB.
 *
 * Run once after deploying the schema change:
 *   node scripts/backfill_usage_counts.js
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import PuzzleModel from "../models/PuzzleSchema.js";
import CompetitionModel from "../models/CompetitionSchema.js";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

async function backfill() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGO_URI);
  console.log("Connected.");

  // 1. Reset all counts to 0 first to get a clean slate
  const resetResult = await PuzzleModel.updateMany({}, { $set: { competitionUsageCount: 0 } });
  console.log(`Reset ${resetResult.modifiedCount} puzzle counts to 0.`);

  // 2. Aggregate usage counts from all competitions
  const usageCounts = await CompetitionModel.aggregate([
    { $unwind: "$puzzles" },
    { $group: { _id: "$puzzles", count: { $sum: 1 } } }
  ]);

  console.log(`Found usage data for ${usageCounts.length} puzzles. Updating...`);

  // 3. Bulk-write the counts
  if (usageCounts.length > 0) {
    const bulkOps = usageCounts.map(({ _id, count }) => ({
      updateOne: {
        filter: { _id },
        update: { $set: { competitionUsageCount: count } }
      }
    }));

    const bulkResult = await PuzzleModel.bulkWrite(bulkOps, { ordered: false });
    console.log(`Updated ${bulkResult.modifiedCount} puzzle usage counts.`);
  }

  console.log("Backfill complete.");
  await mongoose.disconnect();
}

backfill().catch(err => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
