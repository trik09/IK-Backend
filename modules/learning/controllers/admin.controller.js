import LearningSection from "../models/LearningSection.js";
import LearningChapter from "../models/LearningChapter.js";
import LearningExercise from "../models/LearningExercise.js";
import LearningProgress from "../models/LearningProgress.js";
import LearningAttempt from "../models/LearningAttempt.js";
import { slugify, calculatePercent } from "../utils/helpers.js";
import { validateExercisePayload } from "../services/exerciseValidation.service.js";

async function refreshChapterExerciseCount(chapterId) {
  const count = await LearningExercise.countDocuments({
    chapterId,
    isActive: true,
    status: { $ne: "archived" },
  });
  await LearningChapter.findByIdAndUpdate(chapterId, { exerciseCount: count });
}

export const getAdminDashboard = async (req, res) => {
  try {
    const [sections, chapters, exercises, attempts] = await Promise.all([
      LearningSection.countDocuments({ isActive: true }),
      LearningChapter.countDocuments({ isActive: true }),
      LearningExercise.countDocuments({ isActive: true }),
      LearningAttempt.countDocuments(),
    ]);

    const publishedExercises = await LearningExercise.countDocuments({
      status: "published",
      isActive: true,
    });

    const completedProgress = await LearningProgress.countDocuments({
      status: { $in: ["COMPLETED", "MASTERED"] },
    });

    return res.status(200).json({
      success: true,
      data: {
        totals: { sections, chapters, exercises, publishedExercises, attempts, completedProgress },
      },
    });
  } catch (error) {
    console.error("getAdminDashboard error:", error);
    return res.status(500).json({ success: false, message: "Failed to load dashboard" });
  }
};

// --- Sections ---

export const listSections = async (req, res) => {
  try {
    const sections = await LearningSection.find().sort({ order: 1 }).lean();
    return res.status(200).json({ success: true, data: sections });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to list sections" });
  }
};

export const createSection = async (req, res) => {
  try {
    const { title, slug, description, icon, order, difficulty, status, estimatedMinutes } = req.body;
    if (!title) return res.status(400).json({ success: false, message: "Title is required" });

    const finalSlug = slugify(slug || title);
    const existing = await LearningSection.findOne({ slug: finalSlug });
    if (existing) return res.status(409).json({ success: false, message: "Slug already exists" });

    const section = await LearningSection.create({
      title: title.trim(),
      slug: finalSlug,
      description: description || "",
      icon: icon || "FaChess",
      order: order ?? 0,
      difficulty: difficulty || "beginner",
      status: status || "draft",
      estimatedMinutes: estimatedMinutes || 0,
      createdBy: req.admin._id,
    });

    return res.status(201).json({ success: true, data: section });
  } catch (error) {
    console.error("createSection error:", error);
    return res.status(500).json({ success: false, message: "Failed to create section" });
  }
};

export const updateSection = async (req, res) => {
  try {
    const section = await LearningSection.findById(req.params.id);
    if (!section) return res.status(404).json({ success: false, message: "Section not found" });

    const fields = ["title", "description", "icon", "order", "difficulty", "status", "isActive", "estimatedMinutes"];
    for (const field of fields) {
      if (req.body[field] !== undefined) section[field] = req.body[field];
    }
    if (req.body.slug) section.slug = slugify(req.body.slug);

    await section.save();
    return res.status(200).json({ success: true, data: section });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to update section" });
  }
};

export const deleteSection = async (req, res) => {
  try {
    const section = await LearningSection.findByIdAndUpdate(
      req.params.id,
      { status: "archived", isActive: false },
      { new: true }
    );
    if (!section) return res.status(404).json({ success: false, message: "Section not found" });
    return res.status(200).json({ success: true, data: section });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to archive section" });
  }
};

export const reorderSections = async (req, res) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ success: false, message: "orderedIds array required" });
    }
    await Promise.all(
      orderedIds.map((id, index) => LearningSection.findByIdAndUpdate(id, { order: index }))
    );
    return res.status(200).json({ success: true, message: "Sections reordered" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to reorder sections" });
  }
};

// --- Chapters ---

export const listChapters = async (req, res) => {
  try {
    const query = {};
    if (req.query.sectionId) query.sectionId = req.query.sectionId;
    const chapters = await LearningChapter.find(query).sort({ order: 1 }).lean();
    return res.status(200).json({ success: true, data: chapters });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to list chapters" });
  }
};

export const createChapter = async (req, res) => {
  try {
    const { sectionId, title, slug, description, learningObjectives, icon, order, difficulty, status, estimatedMinutes, prerequisiteChapterId, requiredCompletionPercent } = req.body;

    if (!sectionId || !title) {
      return res.status(400).json({ success: false, message: "sectionId and title are required" });
    }

    const section = await LearningSection.findById(sectionId);
    if (!section) return res.status(404).json({ success: false, message: "Section not found" });

    const finalSlug = slugify(slug || title);
    const existing = await LearningChapter.findOne({ sectionId, slug: finalSlug });
    if (existing) return res.status(409).json({ success: false, message: "Chapter slug exists in section" });

    const chapter = await LearningChapter.create({
      sectionId,
      title: title.trim(),
      slug: finalSlug,
      description: description || "",
      learningObjectives: learningObjectives || [],
      icon: icon || "FaChess",
      order: order ?? 0,
      difficulty: difficulty || "beginner",
      status: status || "draft",
      estimatedMinutes: estimatedMinutes || 0,
      prerequisiteChapterId: prerequisiteChapterId || null,
      requiredCompletionPercent: requiredCompletionPercent ?? 100,
      createdBy: req.admin._id,
    });

    return res.status(201).json({ success: true, data: chapter });
  } catch (error) {
    console.error("createChapter error:", error);
    return res.status(500).json({ success: false, message: "Failed to create chapter" });
  }
};

export const updateChapter = async (req, res) => {
  try {
    const chapter = await LearningChapter.findById(req.params.id);
    if (!chapter) return res.status(404).json({ success: false, message: "Chapter not found" });

    const fields = [
      "sectionId", "title", "description", "learningObjectives", "icon", "order",
      "difficulty", "status", "isActive", "estimatedMinutes", "prerequisiteChapterId", "requiredCompletionPercent",
    ];
    for (const field of fields) {
      if (req.body[field] !== undefined) chapter[field] = req.body[field];
    }
    if (req.body.slug) chapter.slug = slugify(req.body.slug);

    await chapter.save();
    return res.status(200).json({ success: true, data: chapter });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to update chapter" });
  }
};

export const deleteChapter = async (req, res) => {
  try {
    const chapter = await LearningChapter.findByIdAndUpdate(
      req.params.id,
      { status: "archived", isActive: false },
      { new: true }
    );
    if (!chapter) return res.status(404).json({ success: false, message: "Chapter not found" });
    return res.status(200).json({ success: true, data: chapter });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to archive chapter" });
  }
};

export const reorderChapters = async (req, res) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ success: false, message: "orderedIds array required" });
    }
    await Promise.all(
      orderedIds.map((id, index) => LearningChapter.findByIdAndUpdate(id, { order: index }))
    );
    return res.status(200).json({ success: true, message: "Chapters reordered" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to reorder chapters" });
  }
};

export const getChapterExercisesAdmin = async (req, res) => {
  try {
    const exercises = await LearningExercise.find({ chapterId: req.params.id })
      .sort({ order: 1 })
      .lean();
    return res.status(200).json({ success: true, data: exercises });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to list exercises" });
  }
};

// --- Exercises ---

export const listExercises = async (req, res) => {
  try {
    const { chapterId, status, difficulty, theme, page = 1, limit = 20 } = req.query;
    const query = {};
    if (chapterId) query.chapterId = chapterId;
    if (status) query.status = status;
    if (difficulty) query.difficulty = difficulty;
    if (theme) query.theme = theme;

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const [items, total] = await Promise.all([
      LearningExercise.find(query).sort({ order: 1 }).skip(skip).limit(parseInt(limit, 10)).lean(),
      LearningExercise.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      data: { items, total, page: parseInt(page, 10), limit: parseInt(limit, 10) },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to list exercises" });
  }
};

export const getExerciseAdmin = async (req, res) => {
  try {
    const exercise = await LearningExercise.findById(req.params.id).lean();
    if (!exercise) return res.status(404).json({ success: false, message: "Exercise not found" });
    return res.status(200).json({ success: true, data: exercise });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to get exercise" });
  }
};

export const createExercise = async (req, res) => {
  try {
    const payload = req.body;
    if (!payload.chapterId || !payload.title || !payload.fen) {
      return res.status(400).json({ success: false, message: "chapterId, title, and fen are required" });
    }

    const chapter = await LearningChapter.findById(payload.chapterId);
    if (!chapter) return res.status(404).json({ success: false, message: "Chapter not found" });

    const validation = validateExercisePayload(payload);
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.errors.join("; ") });
    }

    const exercise = await LearningExercise.create({
      ...payload,
      isValidated: true,
      createdBy: req.admin._id,
    });

    await refreshChapterExerciseCount(payload.chapterId);
    return res.status(201).json({ success: true, data: exercise });
  } catch (error) {
    console.error("createExercise error:", error);
    return res.status(500).json({ success: false, message: "Failed to create exercise" });
  }
};

export const updateExercise = async (req, res) => {
  try {
    const exercise = await LearningExercise.findById(req.params.id);
    if (!exercise) return res.status(404).json({ success: false, message: "Exercise not found" });

    Object.assign(exercise, req.body);

    const validation = validateExercisePayload(exercise.toObject());
    exercise.isValidated = validation.valid;
    if (!validation.valid && req.body.status === "published") {
      return res.status(400).json({ success: false, message: validation.errors.join("; ") });
    }

    await exercise.save();
    await refreshChapterExerciseCount(exercise.chapterId);
    return res.status(200).json({ success: true, data: exercise });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to update exercise" });
  }
};

export const deleteExercise = async (req, res) => {
  try {
    const exercise = await LearningExercise.findByIdAndUpdate(
      req.params.id,
      { status: "archived", isActive: false },
      { new: true }
    );
    if (!exercise) return res.status(404).json({ success: false, message: "Exercise not found" });
    await refreshChapterExerciseCount(exercise.chapterId);
    return res.status(200).json({ success: true, data: exercise });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to archive exercise" });
  }
};

export const duplicateExercise = async (req, res) => {
  try {
    const source = await LearningExercise.findById(req.params.id).lean();
    if (!source) return res.status(404).json({ success: false, message: "Exercise not found" });

    const { _id, createdAt, updatedAt, ...rest } = source;
    const copy = await LearningExercise.create({
      ...rest,
      title: `${rest.title} (Copy)`,
      status: "draft",
      order: rest.order + 1,
      createdBy: req.admin._id,
    });

    await refreshChapterExerciseCount(copy.chapterId);
    return res.status(201).json({ success: true, data: copy });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to duplicate exercise" });
  }
};

export const reorderExercises = async (req, res) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ success: false, message: "orderedIds array required" });
    }
    await Promise.all(
      orderedIds.map((id, index) => LearningExercise.findByIdAndUpdate(id, { order: index }))
    );
    return res.status(200).json({ success: true, message: "Exercises reordered" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to reorder exercises" });
  }
};

export const validateExerciseAdmin = async (req, res) => {
  try {
    const exercise = await LearningExercise.findById(req.params.id);
    if (!exercise) return res.status(404).json({ success: false, message: "Exercise not found" });

    const validation = validateExercisePayload(exercise.toObject());
    exercise.isValidated = validation.valid;
    await exercise.save();

    return res.status(200).json({ success: validation.valid, data: { valid: validation.valid, errors: validation.errors } });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Validation failed" });
  }
};

export const publishExercise = async (req, res) => {
  try {
    const exercise = await LearningExercise.findById(req.params.id);
    if (!exercise) return res.status(404).json({ success: false, message: "Exercise not found" });

    const validation = validateExercisePayload(exercise.toObject());
    if (!validation.valid) {
      return res.status(400).json({ success: false, message: validation.errors.join("; ") });
    }

    exercise.status = "published";
    exercise.isValidated = true;
    await exercise.save();
    return res.status(200).json({ success: true, data: exercise });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to publish exercise" });
  }
};
