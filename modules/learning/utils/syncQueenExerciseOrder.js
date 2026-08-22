/**
 * Apply queen exercise order from module1Curriculum (matches by FEN + targets, preserves progress IDs).
 * Inserts the new Question 3 puzzle when missing and reorders all six exercises.
 *
 * Usage: node modules/learning/utils/syncQueenExerciseOrder.js
 */
import dotenv from "dotenv";
dotenv.config();

import connectDB from "../../../config/db.js";
import LearningChapter from "../models/LearningChapter.js";
import LearningExercise from "../models/LearningExercise.js";
import { MODULE1_CHAPTERS } from "./module1Curriculum.js";
import { parseFenPieces } from "./captureConfig.js";

const QUEEN_SLUG = "the-queen";

function exerciseKey({ fen, targetSquares = [] }) {
  const targets = [...targetSquares].map((sq) => sq.toLowerCase()).sort().join(",");
  return `${fen}|${targets}`;
}

function buildPlayerPieces(def) {
  const sideToMove = "w";
  return (
    def.playerPieces ||
    parseFenPieces(def.fen, sideToMove).map((p) => ({
      square: p.square,
      type: p.type,
      color: p.color,
    }))
  );
}

async function upsertExercise(chapter, def, order, chapterDef, existing) {
  const playerPieces = buildPlayerPieces(def);
  const payload = {
    chapterId: chapter._id,
    title: def.title,
    description: def.description,
    order,
    puzzleType: "capture",
    fen: def.fen,
    playerPieces,
    targetSquares: def.targetSquares,
    targetSquare: def.targetSquares[0] || null,
    optimalMoveCount: def.optimalMoveCount,
    hintArrows: def.hintArrows || [],
    validationRules: def.validationRules || null,
    requiresPromotion: !!def.requiresPromotion,
    sideToMove: "w",
    solutionMoves: [],
    hintLevels: {
      level1: "Look at the piece that needs to move.",
      level2: def.description,
      level3: `Collect every star in ${def.optimalMoveCount} moves or fewer for 3 stars.`,
    },
    explanation: chapterDef.description,
    successMessage: "Correct!",
    failureMessage: "Not quite. Try again.",
    difficulty: "easy",
    status: "published",
    isValidated: true,
    sourceMeta: {
      lichessStageId: chapterDef.lichessStageId,
      lichessLevelId: order + 1,
    },
  };

  if (existing) {
    await LearningExercise.findByIdAndUpdate(existing._id, payload);
    return existing._id;
  }

  const created = await LearningExercise.create(payload);
  return created._id;
}

async function sync() {
  await connectDB();

  const chapter = await LearningChapter.findOne({ slug: QUEEN_SLUG });
  if (!chapter) {
    console.error(`Chapter "${QUEEN_SLUG}" not found.`);
    process.exit(1);
  }

  const queenDef = MODULE1_CHAPTERS.find((ch) => ch.slug === QUEEN_SLUG);
  if (!queenDef || queenDef.exercises.length !== 6) {
    console.error("Curriculum queen chapter must define exactly 6 exercises.");
    process.exit(1);
  }

  const dbExercises = await LearningExercise.find({ chapterId: chapter._id });
  const byKey = new Map(dbExercises.map((ex) => [exerciseKey(ex), ex]));
  const keptIds = new Set();

  for (let i = 0; i < queenDef.exercises.length; i++) {
    const def = queenDef.exercises[i];
    const existing = byKey.get(exerciseKey(def));
    const id = await upsertExercise(chapter, def, i, queenDef, existing);
    keptIds.add(String(id));
    console.log(`${i + 1}. ${def.title} — ${def.targetSquares.join(", ")}`);
  }

  const orphans = dbExercises.filter((ex) => !keptIds.has(String(ex._id)));
  if (orphans.length > 0) {
    console.warn(`Removing ${orphans.length} queen exercise(s) no longer in curriculum.`);
    const orphanIds = orphans.map((ex) => ex._id);
    const LearningProgress = (await import("../models/LearningProgress.js")).default;
    const LearningAttempt = (await import("../models/LearningAttempt.js")).default;
    await LearningProgress.deleteMany({ exerciseId: { $in: orphanIds } });
    await LearningAttempt.deleteMany({ exerciseId: { $in: orphanIds } });
    await LearningExercise.deleteMany({ _id: { $in: orphanIds } });
  }

  await LearningChapter.findByIdAndUpdate(chapter._id, { exerciseCount: 6 });
  console.log("Queen exercise order synced (6 questions).");
  process.exit(0);
}

sync().catch((err) => {
  console.error(err);
  process.exit(1);
});
