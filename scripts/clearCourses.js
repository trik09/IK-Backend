import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import Course from "../models/CourseSchema.js";
import Chapter from "../models/ChapterSchema.js";
import Lesson from "../models/LessonSchema.js";

const clearAllCourses = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/qcfy";
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB.");

    const deletedLessons = await Lesson.deleteMany({});
    const deletedChapters = await Chapter.deleteMany({});
    const deletedCourses = await Course.deleteMany({});

    console.log(`Deleted ${deletedLessons.deletedCount} lessons.`);
    console.log(`Deleted ${deletedChapters.deletedCount} chapters.`);
    console.log(`Deleted ${deletedCourses.deletedCount} courses.`);

    console.log("Course database successfully cleared!");
    process.exit(0);
  } catch (err) {
    console.error("Error clearing courses:", err);
    process.exit(1);
  }
};

clearAllCourses();
