/**
 * Additive seed for Basic Rules — does NOT wipe Chess Pieces data.
 * Usage: node modules/learning/utils/seedBasicRules.js
 */
import dotenv from "dotenv";
dotenv.config();

import connectDB from "../../../config/db.js";
import LearningSection from "../models/LearningSection.js";
import LearningChapter from "../models/LearningChapter.js";
import LearningExercise from "../models/LearningExercise.js";
import { MODULE2_SECTION, MODULE2_CHAPTERS } from "./module2Curriculum.js";

async function seedBasicRules() {
  await connectDB();

  let section = await LearningSection.findOne({ slug: MODULE2_SECTION.slug });
  if (!section) {
    section = await LearningSection.create({
      ...MODULE2_SECTION,
      status: "published",
    });
    console.log(`Created section: ${section.title}`);
  } else {
    console.log(`Section already exists: ${section.title}`);
  }

  for (const chapterDef of MODULE2_CHAPTERS) {
    let chapter = await LearningChapter.findOne({
      sectionId: section._id,
      slug: chapterDef.slug,
    });

    if (!chapter) {
      chapter = await LearningChapter.create({
        sectionId: section._id,
        title: chapterDef.title,
        slug: chapterDef.slug,
        description: chapterDef.description,
        icon: chapterDef.icon,
        order: chapterDef.order ?? 0,
        difficulty: "beginner",
        status: "published",
        estimatedMinutes: 10,
        prerequisiteChapterId: null,
        requiredCompletionPercent: 100,
        exerciseCount: chapterDef.exercises.length,
      });
      console.log(`Created chapter: ${chapter.title}`);
    } else {
      await LearningChapter.findByIdAndUpdate(chapter._id, {
        description: chapterDef.description,
        title: chapterDef.title,
        order: chapterDef.order ?? chapter.order,
      });
      console.log(`Chapter already exists: ${chapter.title} (description synced)`);
    }

    const existingCount = await LearningExercise.countDocuments({ chapterId: chapter._id });
    const shouldCreateMissing = existingCount < chapterDef.exercises.length;

    if (existingCount > 0 && shouldCreateMissing) {
      await LearningExercise.deleteMany({ chapterId: chapter._id });
    }

    for (let i = 0; i < chapterDef.exercises.length; i++) {
      const ex = chapterDef.exercises[i];
      const fields = {
        title: ex.title,
        description: ex.description,
        order: i,
        puzzleType: ex.puzzleType || "move",
        fen: ex.fen,
        playerPieces: ex.playerPieces || [],
        targetSquares: ex.targetSquares || [],
        optimalMoveCount: ex.optimalMoveCount ?? 1,
        hintArrows: ex.hintArrows || [],
        hintLevels: ex.hintLevels || {},
        validationRules: ex.validationRules || null,
        requiresPromotion: Boolean(ex.requiresPromotion),
        sideToMove: "w",
        solutionMoves: [],
        hintsEnabled: ex.hintsEnabled ?? false,
        successMessage: "Correct!",
        failureMessage: "Incorrect. Try again.",
        status: "published",
      };

      const existing = await LearningExercise.findOne({
        chapterId: chapter._id,
        order: i,
      });
      if (existing) {
        await LearningExercise.findByIdAndUpdate(existing._id, { $set: fields });
      } else {
        await LearningExercise.create({
          chapterId: chapter._id,
          ...fields,
        });
      }
    }

    await LearningExercise.deleteMany({
      chapterId: chapter._id,
      order: { $gte: chapterDef.exercises.length },
    });

    await LearningChapter.findByIdAndUpdate(chapter._id, {
      exerciseCount: chapterDef.exercises.length,
    });

    console.log(`Seeded ${chapterDef.exercises.length} exercises for ${chapter.title}`);
  }

  console.log("Basic Rules seed complete.");
  process.exit(0);
}

seedBasicRules().catch((err) => {
  console.error(err);
  process.exit(1);
});
