import Chapter from "../models/ChapterSchema.js";
import Course from "../models/CourseSchema.js";
import Lesson from "../models/LessonSchema.js";

/**
 * POST /api/chapter
 * Create a new chapter in a course. (Admin only)
 */
export const createChapter = async (req, res) => {
  try {
    const { courseId, title, description, sortOrder, isLocked } = req.body;

    if (!courseId || !title) {
      return res.status(400).json({ success: false, message: "courseId and title are required." });
    }

    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ success: false, message: "Course not found." });
    }

    // Determine sortOrder if not provided
    const chapterCount = course.chapters ? course.chapters.length : 0;
    const order = sortOrder !== undefined ? sortOrder : chapterCount;

    const chapter = await Chapter.create({
      course: courseId,
      title,
      description: description || "",
      sortOrder: order,
      isLocked: isLocked || false,
      lessons: [],
    });

    // Add chapter reference to course
    course.chapters.push(chapter._id);
    await course.save();

    return res.status(201).json({ success: true, data: chapter });
  } catch (err) {
    console.error("createChapter error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * PUT /api/chapter/:id
 * Update a chapter. (Admin only)
 */
export const updateChapter = async (req, res) => {
  try {
    const { title, description, sortOrder, isLocked } = req.body;

    const chapter = await Chapter.findById(req.params.id);
    if (!chapter) {
      return res.status(404).json({ success: false, message: "Chapter not found." });
    }

    if (title !== undefined) chapter.title = title;
    if (description !== undefined) chapter.description = description;
    if (sortOrder !== undefined) chapter.sortOrder = sortOrder;
    if (isLocked !== undefined) chapter.isLocked = isLocked;

    await chapter.save();

    return res.status(200).json({ success: true, data: chapter });
  } catch (err) {
    console.error("updateChapter error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * DELETE /api/chapter/:id
 * Delete a chapter and remove its reference from the parent course. (Admin only)
 */
export const deleteChapter = async (req, res) => {
  try {
    const chapter = await Chapter.findById(req.params.id);
    if (!chapter) {
      return res.status(404).json({ success: false, message: "Chapter not found." });
    }

    // Remove chapter from parent course
    await Course.findByIdAndUpdate(chapter.course, {
      $pull: { chapters: chapter._id },
    });

    // Delete associated lessons
    if (chapter.lessons && chapter.lessons.length > 0) {
      await Lesson.deleteMany({ _id: { $in: chapter.lessons } });
    }

    await Chapter.findByIdAndDelete(req.params.id);

    return res.status(200).json({ success: true, message: "Chapter and its lessons deleted." });
  } catch (err) {
    console.error("deleteChapter error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * PUT /api/chapter/reorder
 * Batch update chapter sort orders for a course. (Admin only)
 */
export const reorderChapters = async (req, res) => {
  try {
    const { courseId, chapterOrder } = req.body; // chapterOrder = [{ id: "...", sortOrder: 0 }, ...]

    if (!courseId || !Array.isArray(chapterOrder)) {
      return res.status(400).json({ success: false, message: "courseId and chapterOrder array required." });
    }

    const updates = chapterOrder.map((item) =>
      Chapter.findByIdAndUpdate(item.id, { sortOrder: item.sortOrder })
    );
    await Promise.all(updates);

    // Also update course chapters array order
    const orderedIds = chapterOrder
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((item) => item.id);

    await Course.findByIdAndUpdate(courseId, { chapters: orderedIds });

    return res.status(200).json({ success: true, message: "Chapters reordered successfully." });
  } catch (err) {
    console.error("reorderChapters error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};
