/**
 * Backfill playerPieces on existing learning exercises (no progress wipe).
 * Usage: node modules/learning/utils/backfillLearningPlayerPieces.js
 */
import dotenv from "dotenv";
dotenv.config();

import connectDB from "../../../config/db.js";
import LearningExercise from "../models/LearningExercise.js";
import { parseFenPieces } from "./captureConfig.js";

async function backfill() {
  await connectDB();

  const exercises = await LearningExercise.find({}).lean();
  let updated = 0;

  for (const exercise of exercises) {
    const side = exercise.sideToMove || "w";
    const hasPieces =
      Array.isArray(exercise.playerPieces) && exercise.playerPieces.length > 0;
    if (hasPieces || !exercise.fen) continue;

    const playerPieces = parseFenPieces(exercise.fen, side);
    if (playerPieces.length === 0) continue;

    await LearningExercise.updateOne(
      { _id: exercise._id },
      { $set: { playerPieces } }
    );
    updated += 1;
  }

  console.log(`Backfilled playerPieces on ${updated} exercises.`);
  process.exit(0);
}

backfill().catch((err) => {
  console.error(err);
  process.exit(1);
});
