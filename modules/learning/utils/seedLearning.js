/**
 * Seed Module 1 — Chess Pieces (32 Lichess-parity exercises).
 * Usage: node modules/learning/utils/seedLearning.js
 */
import dotenv from "dotenv";
dotenv.config();

import connectDB from "../../../config/db.js";
import LearningSection from "../models/LearningSection.js";
import LearningChapter from "../models/LearningChapter.js";
import LearningExercise from "../models/LearningExercise.js";
import {
  MODULE1_SECTION,
  MODULE1_CHAPTERS,
} from "./module1Curriculum.js";
import { parseFenPieces } from "./captureConfig.js";

async function seed() {
  await connectDB();

  await LearningExercise.deleteMany({});
  await LearningChapter.deleteMany({});
  await LearningSection.deleteMany({});

  const section = await LearningSection.create({
    ...MODULE1_SECTION,
    status: "published",
  });

  let chapterOrder = 0;
  let prevChapterId = null;

  for (const chapterDef of MODULE1_CHAPTERS) {
    const chapter = await LearningChapter.create({
      sectionId: section._id,
      title: chapterDef.title,
      slug: chapterDef.slug,
      description: chapterDef.description,
      icon: chapterDef.icon,
      order: chapterOrder++,
      difficulty: "beginner",
      status: "published",
      estimatedMinutes: Math.max(5, chapterDef.exercises.length * 2),
      prerequisiteChapterId: prevChapterId,
      requiredCompletionPercent: 100,
      exerciseCount: chapterDef.exercises.length,
    });

    for (let i = 0; i < chapterDef.exercises.length; i++) {
      const ex = chapterDef.exercises[i];
      const sideToMove = "w";
      const playerPieces =
        ex.playerPieces ||
        parseFenPieces(ex.fen, sideToMove).map((p) => ({
          square: p.square,
          type: p.type,
          color: p.color,
        }));

      await LearningExercise.create({
        chapterId: chapter._id,
        title: ex.title,
        description: ex.description,
        order: i,
        puzzleType: "capture",
        fen: ex.fen,
        playerPieces,
        targetSquares: ex.targetSquares,
        targetSquare: ex.targetSquares[0] || null,
        optimalMoveCount: ex.optimalMoveCount,
        hintArrows: ex.hintArrows || [],
        validationRules: ex.validationRules || null,
        requiresPromotion: !!ex.requiresPromotion,
        sideToMove: "w",
        solutionMoves: [],
        hintLevels: {
          level1: "Look at the piece that needs to move.",
          level2: ex.description,
          level3: `Collect every star in ${ex.optimalMoveCount} moves or fewer for 3 stars.`,
        },
        explanation: chapterDef.description,
        successMessage: "Correct!",
        failureMessage: "Not quite. Try again.",
        difficulty: "easy",
        status: "published",
        isValidated: true,
        sourceMeta: {
          lichessStageId: chapterDef.lichessStageId,
          lichessLevelId: i + 1,
        },
      });
    }

    prevChapterId = chapter._id;
  }

  const totalExercises = MODULE1_CHAPTERS.reduce(
    (sum, ch) => sum + ch.exercises.length,
    0
  );
  console.log(
    `Learning seed complete: 1 section, ${MODULE1_CHAPTERS.length} chapters, ${totalExercises} exercises`
  );
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
