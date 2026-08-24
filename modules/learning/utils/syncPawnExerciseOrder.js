/**
 * Apply pawn exercise order from module1Curriculum (matches by FEN, preserves progress IDs).
 *
 * Usage: node modules/learning/utils/syncPawnExerciseOrder.js
 */
import dotenv from "dotenv";
dotenv.config();

import connectDB from "../../../config/db.js";
import LearningChapter from "../models/LearningChapter.js";
import LearningExercise from "../models/LearningExercise.js";
import { MODULE1_CHAPTERS } from "./module1Curriculum.js";
import { parseFenPieces } from "./captureConfig.js";

const PAWN_SLUG = "the-pawn";

async function sync() {
  await connectDB();

  const chapter = await LearningChapter.findOne({ slug: PAWN_SLUG });
  if (!chapter) {
    console.error(`Chapter "${PAWN_SLUG}" not found.`);
    process.exit(1);
  }

  const pawnDef = MODULE1_CHAPTERS.find((ch) => ch.slug === PAWN_SLUG);
  if (!pawnDef || pawnDef.exercises.length !== 6) {
    console.error("Curriculum pawn chapter must define exactly 6 exercises.");
    process.exit(1);
  }

  const dbExercises = await LearningExercise.find({ chapterId: chapter._id }).lean();
  const byFen = new Map(dbExercises.map((ex) => [ex.fen, ex]));

  for (let i = 0; i < pawnDef.exercises.length; i++) {
    const def = pawnDef.exercises[i];
    const existing = byFen.get(def.fen);
    if (!existing) {
      console.error(`No DB exercise found for FEN: ${def.fen}`);
      process.exit(1);
    }

    const playerPieces =
      def.playerPieces ||
      parseFenPieces(def.fen, "w").map((p) => ({
        square: p.square,
        type: p.type,
        color: p.color,
      }));

    await LearningExercise.findByIdAndUpdate(existing._id, {
      order: i,
      title: def.title,
      description: def.description,
      fen: def.fen,
      playerPieces,
      targetSquares: def.targetSquares,
      targetSquare: def.targetSquares[0] || null,
      optimalMoveCount: def.optimalMoveCount,
      hintArrows: def.hintArrows || [],
      validationRules: def.validationRules || null,
      requiresPromotion: !!def.requiresPromotion,
      "sourceMeta.lichessStageId": pawnDef.lichessStageId,
      "sourceMeta.lichessLevelId": i + 1,
    });

    console.log(`${i + 1}. ${def.title}`);
  }

  await LearningChapter.findByIdAndUpdate(chapter._id, { exerciseCount: 6 });
  console.log("Pawn exercise order synced.");
  process.exit(0);
}

sync().catch((err) => {
  console.error(err);
  process.exit(1);
});
