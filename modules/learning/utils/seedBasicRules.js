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
        order: 0,
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
      });
      console.log(`Chapter already exists: ${chapter.title} (description synced)`);
    }

    const existingCount = await LearningExercise.countDocuments({ chapterId: chapter._id });
    if (existingCount >= chapterDef.exercises.length) {
      console.log(`Exercises already seeded for ${chapter.title}`);
      continue;
    }

    if (existingCount > 0) {
      await LearningExercise.deleteMany({ chapterId: chapter._id });
    }

    for (let i = 0; i < chapterDef.exercises.length; i++) {
      const ex = chapterDef.exercises[i];
      await LearningExercise.create({
        chapterId: chapter._id,
        title: ex.title,
        description: ex.description,
        order: i,
        puzzleType: "move",
        fen: ex.fen,
        playerPieces: [],
        targetSquares: [],
        optimalMoveCount: 1,
        hintArrows: ex.hintArrows || [],
        validationRules: ex.validationRules || null,
        sideToMove: "w",
        solutionMoves: [],
        hintsEnabled: false,
        successMessage: "Correct!",
        failureMessage: "Incorrect. Try again.",
        status: "published",
      });
    }

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
