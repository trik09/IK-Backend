import Lesson from "../models/LessonSchema.js";
import Chapter from "../models/ChapterSchema.js";
import Course from "../models/CourseSchema.js";
import LessonProgress from "../models/LessonProgressSchema.js";
import Enrollment from "../models/EnrollmentSchema.js";

/**
 * GET /api/lesson/:id
 * Get full lesson with blocks. Access check: public vs pro course level.
 */
export const getLessonById = async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id)
      .populate("chapter", "title sortOrder")
      .populate("course", "title slug accessLevel");

    if (!lesson) {
      return res.status(404).json({ success: false, message: "Lesson not found." });
    }

    // Check Pro requirement if course is Pro
    if (lesson.course?.accessLevel === "pro") {
      const user = req.user;
      if (!user || !user.membership || user.membership.plan !== "pro" || user.membership.status !== "active") {
        return res.status(403).json({
          success: false,
          message: "QCFY Pro membership required to view this lesson.",
          code: "PRO_REQUIRED",
        });
      }
    }

    return res.status(200).json({ success: true, data: lesson });
  } catch (err) {
    console.error("getLessonById error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * POST /api/lesson
 * Create a new lesson in a chapter. (Admin only)
 */
export const createLesson = async (req, res) => {
  try {
    const {
      chapterId, courseId, title, slug, description, thumbnail, type,
      blocks, sortOrder, estimatedMinutes, completionType, passingScore,
      coachName, coachAvatar,
    } = req.body;

    if (!chapterId || !courseId || !title) {
      return res.status(400).json({ success: false, message: "chapterId, courseId, and title are required." });
    }

    const chapter = await Chapter.findById(chapterId);
    if (!chapter) {
      return res.status(404).json({ success: false, message: "Chapter not found." });
    }

    const lessonSlug = slug ? slug.toLowerCase() : `lesson-${Date.now()}`;

    const lesson = await Lesson.create({
      chapter: chapterId,
      course: courseId,
      title,
      slug: lessonSlug,
      description: description || "",
      thumbnail: thumbnail || "",
      type: type || "theory",
      blocks: blocks || [],
      sortOrder: sortOrder !== undefined ? sortOrder : chapter.lessons.length,
      estimatedMinutes: estimatedMinutes || 10,
      isPublished: false,
      completionType: completionType || "all_blocks",
      passingScore: passingScore || 70,
      coachName: coachName || "",
      coachAvatar: coachAvatar || "",
    });

    // Add lesson reference to chapter
    chapter.lessons.push(lesson._id);
    await chapter.save();

    // Recalculate totalLessons on Course
    const totalCount = await Lesson.countDocuments({ course: courseId });
    await Course.findByIdAndUpdate(courseId, { totalLessons: totalCount });

    return res.status(201).json({ success: true, data: lesson });
  } catch (err) {
    console.error("createLesson error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * PUT /api/lesson/:id
 * Update lesson metadata and settings. (Admin only)
 */
export const updateLesson = async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id);
    if (!lesson) {
      return res.status(404).json({ success: false, message: "Lesson not found." });
    }

    const allowedFields = [
      "title", "slug", "description", "thumbnail", "type", "sortOrder",
      "estimatedMinutes", "isPublished", "completionType", "passingScore",
      "coachName", "coachAvatar",
    ];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        lesson[field] = req.body[field];
      }
    }

    await lesson.save();

    return res.status(200).json({ success: true, data: lesson });
  } catch (err) {
    console.error("updateLesson error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * PUT /api/lesson/:id/blocks
 * Update blocks array of a lesson. (Admin only — Notion-style block editor API)
 */
export const updateLessonBlocks = async (req, res) => {
  try {
    const { blocks } = req.body;

    if (!Array.isArray(blocks)) {
      return res.status(400).json({ success: false, message: "blocks array is required." });
    }

    const lesson = await Lesson.findById(req.params.id);
    if (!lesson) {
      return res.status(404).json({ success: false, message: "Lesson not found." });
    }

    lesson.blocks = blocks;
    await lesson.save();

    return res.status(200).json({ success: true, data: lesson });
  } catch (err) {
    console.error("updateLessonBlocks error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * DELETE /api/lesson/:id
 * Delete a lesson and pull reference from parent chapter. (Admin only)
 */
export const deleteLesson = async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id);
    if (!lesson) {
      return res.status(404).json({ success: false, message: "Lesson not found." });
    }

    // Pull from chapter
    await Chapter.findByIdAndUpdate(lesson.chapter, {
      $pull: { lessons: lesson._id },
    });

    await Lesson.findByIdAndDelete(req.params.id);

    // Update totalLessons count on course
    if (lesson.course) {
      const totalCount = await Lesson.countDocuments({ course: lesson.course });
      await Course.findByIdAndUpdate(lesson.course, { totalLessons: totalCount });
    }

    return res.status(200).json({ success: true, message: "Lesson deleted." });
  } catch (err) {
    console.error("deleteLesson error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * POST /api/lesson/:id/progress
 * Record/update student progress on a lesson.
 */
export const updateProgress = async (req, res) => {
  try {
    const userId = req.user._id;
    const lessonId = req.params.id;
    const { blockId, isCompleted, timeSpent, quizScore } = req.body;

    const lesson = await Lesson.findById(lessonId);
    if (!lesson) {
      return res.status(404).json({ success: false, message: "Lesson not found." });
    }

    let progress = await LessonProgress.findOne({ user: userId, lesson: lessonId });

    if (!progress) {
      progress = new LessonProgress({
        user: userId,
        lesson: lessonId,
        course: lesson.course,
        chapter: lesson.chapter,
        status: "in_progress",
        blocksCompleted: [],
        timeSpent: 0,
      });
    }

    // Add block ID to completed list if provided and not already present
    if (blockId) {
      progress.lastBlockId = blockId;
      if (!progress.blocksCompleted.includes(blockId)) {
        progress.blocksCompleted.push(blockId);
      }
    }

    if (timeSpent) {
      progress.timeSpent += Math.max(0, parseInt(timeSpent));
    }

    if (quizScore !== undefined) {
      progress.quizScore = quizScore;
    }

    // Determine completion
    if (isCompleted || progress.blocksCompleted.length >= lesson.blocks.length) {
      progress.status = "completed";
      progress.completedAt = new Date();
    } else if (progress.blocksCompleted.length > 0) {
      progress.status = "in_progress";
    }

    await progress.save();

    // Update Enrollment overall percentage
    const allCourseLessons = await Lesson.find({ course: lesson.course, isPublished: true }).select("_id");
    const totalCourseLessons = allCourseLessons.length || 1;
    const completedCount = await LessonProgress.countDocuments({
      user: userId,
      course: lesson.course,
      status: "completed",
    });

    const percentage = Math.min(100, Math.round((completedCount / totalCourseLessons) * 100));

    await Enrollment.findOneAndUpdate(
      { user: userId, course: lesson.course },
      {
        progress: percentage,
        lastAccessedAt: new Date(),
        lastLessonId: lessonId,
        lastBlockId: blockId || progress.lastBlockId,
        status: percentage >= 100 ? "completed" : "active",
        completedAt: percentage >= 100 ? new Date() : null,
      }
    );

    return res.status(200).json({
      success: true,
      data: {
        progress,
        courseProgress: percentage,
      },
    });
  } catch (err) {
    console.error("updateProgress error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};
