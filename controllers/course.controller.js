import Course from "../models/CourseSchema.js";
import Chapter from "../models/ChapterSchema.js";
import Lesson from "../models/LessonSchema.js";
import Enrollment from "../models/EnrollmentSchema.js";
import LessonProgress from "../models/LessonProgressSchema.js";

/**
 * GET /api/course
 * List published courses (public). Supports filters: category, difficulty, accessLevel, search.
 */
export const getCourses = async (req, res) => {
  try {
    const { category, difficulty, accessLevel, search, featured, page = 1, limit = 20 } = req.query;

    const filter = { isPublished: true };

    if (category) filter.category = category;
    if (difficulty) filter.difficulty = difficulty;
    if (accessLevel) filter.accessLevel = accessLevel;
    if (featured === "true") filter.isFeatured = true;
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { subtitle: { $regex: search, $options: "i" } },
        { tags: { $in: [new RegExp(search, "i")] } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [courses, total] = await Promise.all([
      Course.find(filter)
        .populate("category", "name slug color icon")
        .select("-chapters") // Don't send chapter IDs in list view
        .sort({ isFeatured: -1, publishedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Course.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: courses,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error("getCourses error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * GET /api/course/admin/all
 * List ALL courses (including drafts) for admin panel.
 */
export const getCoursesAdmin = async (req, res) => {
  try {
    const { search, category, status, page = 1, limit = 20 } = req.query;

    const filter = {};
    if (category) filter.category = category;
    if (status === "published") filter.isPublished = true;
    if (status === "draft") filter.isPublished = false;
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { slug: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [courses, total] = await Promise.all([
      Course.find(filter)
        .populate("category", "name slug color")
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Course.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: courses,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (err) {
    console.error("getCoursesAdmin error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * GET /api/course/:slug
 * Get course detail by slug (public info).
 */
export const getCourseBySlug = async (req, res) => {
  try {
    const course = await Course.findOne({ slug: req.params.slug })
      .populate("category", "name slug color icon")
      .populate("prerequisites", "title slug thumbnail")
      .populate({
        path: "chapters",
        select: "title description sortOrder lessons",
        options: { sort: { sortOrder: 1 } },
        populate: {
          path: "lessons",
          select: "title slug type estimatedMinutes sortOrder isPublished",
          options: { sort: { sortOrder: 1 } },
        },
      });

    if (!course) {
      return res.status(404).json({ success: false, message: "Course not found." });
    }

    // If not published and requester is not admin, hide it
    if (!course.isPublished) {
      // Check if the request is from admin (has admin auth header)
      const isAdmin = req.headers["x-admin-access"] === "true";
      if (!isAdmin) {
        return res.status(404).json({ success: false, message: "Course not found." });
      }
    }

    return res.status(200).json({ success: true, data: course });
  } catch (err) {
    console.error("getCourseBySlug error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * GET /api/course/id/:id
 * Get course by MongoDB ID (admin use).
 */
export const getCourseById = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id)
      .populate("category", "name slug color icon")
      .populate("prerequisites", "title slug")
      .populate({
        path: "chapters",
        options: { sort: { sortOrder: 1 } },
        populate: {
          path: "lessons",
          select: "title slug type estimatedMinutes sortOrder isPublished blocks",
          options: { sort: { sortOrder: 1 } },
        },
      });

    if (!course) {
      return res.status(404).json({ success: false, message: "Course not found." });
    }

    return res.status(200).json({ success: true, data: course });
  } catch (err) {
    console.error("getCourseById error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * POST /api/course
 * Create a new course (admin).
 */
export const createCourse = async (req, res) => {
  try {
    const {
      title, slug, subtitle, description, thumbnail, previewVideo,
      category, tags, difficulty, estimatedHours, outcomes,
      prerequisites, accessLevel, isFeatured, certificateEnabled,
      certificateTemplate, completionRules, instructor, instructorAvatar,
    } = req.body;

    if (!title || !slug) {
      return res.status(400).json({ success: false, message: "Title and slug are required." });
    }

    // Slug uniqueness check
    const existing = await Course.findOne({ slug: slug.toLowerCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: "A course with this slug already exists." });
    }

    const course = await Course.create({
      title,
      slug: slug.toLowerCase(),
      subtitle: subtitle || "",
      description: description || "",
      thumbnail: thumbnail || "",
      previewVideo: previewVideo || "",
      category: category || null,
      tags: tags || [],
      difficulty: difficulty || "beginner",
      estimatedHours: estimatedHours || 0,
      outcomes: outcomes || [],
      prerequisites: prerequisites || [],
      accessLevel: accessLevel || "pro",
      isFeatured: isFeatured || false,
      certificateEnabled: certificateEnabled || false,
      certificateTemplate: certificateTemplate || "default",
      completionRules: completionRules || { type: "all_lessons", percentage: 100 },
      instructor: instructor || "",
      instructorAvatar: instructorAvatar || "",
      createdBy: req.user?._id || null,
    });

    return res.status(201).json({ success: true, data: course });
  } catch (err) {
    console.error("createCourse error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * PUT /api/course/:id
 * Update a course (admin).
 */
export const updateCourse = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) {
      return res.status(404).json({ success: false, message: "Course not found." });
    }

    const allowedFields = [
      "title", "slug", "subtitle", "description", "thumbnail", "previewVideo",
      "category", "tags", "difficulty", "estimatedHours", "outcomes",
      "prerequisites", "accessLevel", "isFeatured", "isPublished",
      "certificateEnabled", "certificateTemplate", "completionRules",
      "instructor", "instructorAvatar",
    ];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        if (field === "slug") {
          const newSlug = req.body.slug.toLowerCase();
          if (newSlug !== course.slug) {
            const existing = await Course.findOne({ slug: newSlug });
            if (existing) {
              return res.status(400).json({ success: false, message: "Slug already in use." });
            }
          }
          course.slug = newSlug;
        } else {
          course[field] = req.body[field];
        }
      }
    }

    // Handle publish transition
    if (req.body.isPublished === true && !course.publishedAt) {
      course.publishedAt = new Date();
      course.version = (course.version || 0) + 1;
    }

    await course.save();

    return res.status(200).json({ success: true, data: course });
  } catch (err) {
    console.error("updateCourse error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * DELETE /api/course/:id
 * Soft-delete a course (unpublish). Admin only.
 */
export const deleteCourse = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) {
      return res.status(404).json({ success: false, message: "Course not found." });
    }

    // Soft delete: unpublish instead of hard-deleting to preserve enrolled student data
    course.isPublished = false;
    await course.save();

    return res.status(200).json({ success: true, message: "Course unpublished (soft-deleted)." });
  } catch (err) {
    console.error("deleteCourse error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * POST /api/course/:id/duplicate
 * Deep clone a course with all chapters and lessons. Admin only.
 */
export const duplicateCourse = async (req, res) => {
  try {
    const original = await Course.findById(req.params.id)
      .populate({
        path: "chapters",
        populate: { path: "lessons" },
      });

    if (!original) {
      return res.status(404).json({ success: false, message: "Course not found." });
    }

    // Create new course
    const newCourse = await Course.create({
      ...original.toObject(),
      _id: undefined,
      title: `${original.title} (Copy)`,
      slug: `${original.slug}-copy-${Date.now()}`,
      isPublished: false,
      publishedAt: null,
      totalEnrollments: 0,
      averageRating: 0,
      version: 1,
      chapters: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Clone chapters and lessons
    const newChapterIds = [];
    for (const chapter of original.chapters || []) {
      const newLessonIds = [];
      for (const lesson of chapter.lessons || []) {
        const lessonObj = typeof lesson.toObject === "function" ? lesson.toObject() : lesson;
        const newLesson = await Lesson.create({
          ...lessonObj,
          _id: undefined,
          course: newCourse._id,
          chapter: undefined, // Will be set below
          isPublished: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        newLessonIds.push(newLesson._id);
      }

      const chapterObj = typeof chapter.toObject === "function" ? chapter.toObject() : chapter;
      const newChapter = await Chapter.create({
        ...chapterObj,
        _id: undefined,
        course: newCourse._id,
        lessons: newLessonIds,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Update lesson chapter references
      await Lesson.updateMany(
        { _id: { $in: newLessonIds } },
        { chapter: newChapter._id }
      );

      newChapterIds.push(newChapter._id);
    }

    newCourse.chapters = newChapterIds;
    await newCourse.save();

    return res.status(201).json({ success: true, data: newCourse, message: "Course duplicated successfully." });
  } catch (err) {
    console.error("duplicateCourse error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * POST /api/course/:id/enroll
 * Enroll the authenticated user in a course.
 */
export const enrollInCourse = async (req, res) => {
  try {
    const userId = req.user._id;
    const courseId = req.params.id;

    const course = await Course.findById(courseId);
    if (!course || !course.isPublished) {
      return res.status(404).json({ success: false, message: "Course not found." });
    }

    // Check Pro requirement
    if (course.accessLevel === "pro") {
      const userMembership = req.user.membership;
      if (!userMembership || userMembership.plan !== "pro" || userMembership.status !== "active") {
        return res.status(403).json({
          success: false,
          message: "QCFY Pro membership required to enroll in this course.",
          code: "PRO_REQUIRED",
        });
      }
    }

    // Check if already enrolled
    const existing = await Enrollment.findOne({ user: userId, course: courseId });
    if (existing) {
      return res.status(200).json({
        success: true,
        message: "Already enrolled.",
        data: existing,
      });
    }

    // Create enrollment
    const enrollment = await Enrollment.create({
      user: userId,
      course: courseId,
    });

    // Increment enrollment counter
    await Course.findByIdAndUpdate(courseId, { $inc: { totalEnrollments: 1 } });

    return res.status(201).json({
      success: true,
      message: "Enrolled successfully!",
      data: enrollment,
    });
  } catch (err) {
    console.error("enrollInCourse error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * GET /api/course/:id/progress
 * Get the authenticated user's progress in a course.
 */
export const getCourseProgress = async (req, res) => {
  try {
    const userId = req.user._id;
    const courseId = req.params.id;

    const enrollment = await Enrollment.findOne({ user: userId, course: courseId });
    if (!enrollment) {
      return res.status(200).json({
        success: true,
        enrolled: false,
        data: null,
      });
    }

    // Get all lesson progress for this course
    const lessonProgress = await LessonProgress.find({ user: userId, course: courseId });

    return res.status(200).json({
      success: true,
      enrolled: true,
      data: {
        enrollment,
        lessonProgress,
      },
    });
  } catch (err) {
    console.error("getCourseProgress error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * GET /api/course/my-courses
 * Get all courses the authenticated user is enrolled in.
 */
export const getMyCourses = async (req, res) => {
  try {
    const userId = req.user._id;

    const enrollments = await Enrollment.find({ user: userId })
      .populate({
        path: "course",
        select: "title slug thumbnail difficulty estimatedHours totalLessons category instructor accessLevel",
        populate: { path: "category", select: "name color" },
      })
      .sort({ lastAccessedAt: -1 });

    return res.status(200).json({
      success: true,
      data: enrollments,
    });
  } catch (err) {
    console.error("getMyCourses error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};
