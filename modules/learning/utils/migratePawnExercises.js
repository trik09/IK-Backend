/**
 * Remove pawn levels 3 and 8, renumber the remaining six exercises (0–5).
 * Preserves all other chapters and user progress on kept exercises.
 *
 * Usage: node modules/learning/utils/migratePawnExercises.js
 */
import dotenv from "dotenv";
dotenv.config();

import connectDB from "../../../config/db.js";
import LearningChapter from "../models/LearningChapter.js";
import LearningExercise from "../models/LearningExercise.js";
import LearningProgress from "../models/LearningProgress.js";
import LearningAttempt from "../models/LearningAttempt.js";
import { MODULE1_CHAPTERS } from "./module1Curriculum.js";

const PAWN_SLUG = "the-pawn";
const REMOVED_LEVEL_IDS = new Set([3, 8]);

async function migrate() {
  await connectDB();

  const chapter = await LearningChapter.findOne({ slug: PAWN_SLUG });
  if (!chapter) {
    console.error(`Chapter "${PAWN_SLUG}" not found. Run seed:learning first.`);
    process.exit(1);
  }

  const exercises = await LearningExercise.find({ chapterId: chapter._id }).sort({
    order: 1,
  });

  if (exercises.length === 0) {
    console.error("No pawn exercises found.");
    process.exit(1);
  }

  const toRemove = exercises.filter((ex) => {
    const levelId = ex.sourceMeta?.lichessLevelId ?? ex.order + 1;
    return REMOVED_LEVEL_IDS.has(levelId);
  });

  if (toRemove.length === 0 && exercises.length === 6) {
    console.log("Pawn chapter already has 6 exercises — nothing to migrate.");
    process.exit(0);
  }

  const removeIds = toRemove.map((ex) => ex._id);

  if (removeIds.length > 0) {
    const progressResult = await LearningProgress.deleteMany({
      exerciseId: { $in: removeIds },
    });
    const attemptResult = await LearningAttempt.deleteMany({
      exerciseId: { $in: removeIds },
    });
    await LearningExercise.deleteMany({ _id: { $in: removeIds } });
    console.log(
      `Removed ${removeIds.length} pawn exercise(s); ` +
        `${progressResult.deletedCount} progress row(s), ` +
        `${attemptResult.deletedCount} attempt(s).`
    );
  }

  const pawnDef = MODULE1_CHAPTERS.find((ch) => ch.slug === PAWN_SLUG);
  if (!pawnDef || pawnDef.exercises.length !== 6) {
    console.error("Curriculum pawn chapter must define exactly 6 exercises.");
    process.exit(1);
  }

  const remaining = await LearningExercise.find({ chapterId: chapter._id }).sort({
    order: 1,
  });

  if (remaining.length !== 6) {
    console.warn(
      `Expected 6 remaining exercises, found ${remaining.length}. ` +
        "Reconcile manually or run seed:learning on a fresh database."
    );
  }

  for (let i = 0; i < pawnDef.exercises.length; i++) {
    const def = pawnDef.exercises[i];
    const existing = remaining.find((ex) => ex.fen === def.fen);
    if (!existing) {
      console.warn(`No exercise in DB for FEN at order ${i + 1}: ${def.title}`);
      continue;
    }
    await LearningExercise.findByIdAndUpdate(existing._id, {
      order: i,
      title: def.title,
      description: def.description,
      fen: def.fen,
      targetSquares: def.targetSquares,
      targetSquare: def.targetSquares[0] || null,
      optimalMoveCount: def.optimalMoveCount,
      hintArrows: def.hintArrows || [],
      validationRules: def.validationRules || null,
      requiresPromotion: !!def.requiresPromotion,
      "sourceMeta.lichessLevelId": i + 1,
    });
  }

  await LearningChapter.findByIdAndUpdate(chapter._id, { exerciseCount: 6 });

  console.log("Pawn migration complete: 6 exercises, order 1–6.");
  process.exit(0);
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
