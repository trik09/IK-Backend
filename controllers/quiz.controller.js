import QuizModel from "../models/QuizSchema.js";
import ExamModel from "../models/ExamSchema.js";
import mongoose from "mongoose";
import { isValidValidationType, validateRulesForType } from "../utils/validationHelper.js";
import { validateBoardBuilder } from "../utils/boardBuilderEngine.js";
import { validateBoardBuilderSolution } from "../utils/boardBuilderSolutionValidator.js";
import { sanitizeQuizForUser } from "../utils/examQuizSanitize.js";
import { invalidateQuizAnswerCache } from "../utils/quizAnswerCache.js";

function normalizeQuizBody(body = {}) {
  const normalized = { ...body };

  if (body.type === "piece_combination" && !body.pieceCombination) {
    normalized.pieceCombination = {
      description: body.description || "",
      targetPiece: body.targetPiece,
      slotCount: body.slotCount,
      requiredPieces: body.requiredPieces,
    };
  }

  if (body.type === "piece_value" && !body.pieceValue) {
    normalized.pieceValue = {
      description: body.description || "",
      pieceValues: body.pieceValues,
    };
  }

  if (body.type === "sequence_ordering" && !body.sequenceOrdering) {
    normalized.sequenceOrdering = {
      description: body.description || "",
      sequenceItems: body.sequenceItems,
    };
  }

  if (body.type === "board_move_challenge" && !body.boardMoveChallenge) {
    normalized.boardMoveChallenge = {
      description: body.description || "",
      fen: body.fen,
      firstMoveBy: body.firstMoveBy,
      acceptedMoves: body.acceptedMoves,
      correctMove: body.correctMove,
    };
    normalized.fen = body.fen;
    normalized.firstMoveBy = body.firstMoveBy;
    normalized.acceptedMoves = body.acceptedMoves;
    normalized.correctMove = body.correctMove;
  }

  // Board builder uses `instructions` (and questionText) for student-facing copy.
  // Clear top-level description so it does not duplicate instructions in exam UI.
  if (body.type === "board_builder") {
    normalized.description = "";
  }

  return normalized;
}

// Helper to validate quiz payload for all supported types
function validateQuizPayload(payload) {
  const {
    type,
    isBoardBased,
    fen,
    options,
    pairs,
    pieceCombination,
    pieceValue,
    sequenceOrdering,
    boardMoveChallenge,
    acceptedMoves,
  } = payload;

  if (!type) return "Quiz type is required";

  switch (type) {
    case "mcq":
    case "fill_in_the_blank":
    case "yes_no":
      if (!options || options.length < 2) return "MCQ must have at least 2 options";
      if (!options.some(o => o.isCorrect)) return "MCQ must have at least one correct option";
      if (payload.isBoardBased) {
        if (!fen) return "Board MCQ requires a FEN string";
      }
      return null;
    case "column_matching":
      if (payload.matchingSubtype === 'board_column_matching') {
        if (!payload.boards || payload.boards.length < 1) return "Column matching must have at least 1 board";
      } else {
        if (!pairs || pairs.length < 2) return "Column matching must have at least 2 pairs";
      }
      return null;
    case "piece_combination": {
      if (!pieceCombination) return "Piece Combination data is required";
      const { targetPiece, slotCount, requiredPieces } = pieceCombination;
      if (!targetPiece) return "targetPiece is required for piece_combination";
      if (!Number.isInteger(slotCount) || slotCount < 1) return "slotCount must be a positive integer";
      if (!Array.isArray(requiredPieces) || requiredPieces.length !== slotCount) {
        return "requiredPieces length must match slotCount";
      }
      return null;
    }
    case "piece_value": {
      if (!pieceValue) return "Piece Value data is required";
      const { pieceValues } = pieceValue;
      if (!Array.isArray(pieceValues) || pieceValues.length === 0) return "pieceValues array is required";
      return null;
    }
    case "sequence_ordering": {
      if (!sequenceOrdering) return "Sequence Ordering data is required";
      const { sequenceItems } = sequenceOrdering;
      if (!Array.isArray(sequenceItems) || sequenceItems.length < 3) {
        return "At least 3 sequence items are required";
      }
      return null;
    }
    case "board_move_challenge": {
      const bmc = boardMoveChallenge || {};
      const moves = acceptedMoves || bmc.acceptedMoves;
      const position = fen || bmc.fen;
      if (!position) return "Board Move Challenge requires a FEN string";
      if (!Array.isArray(moves) || moves.length < 1) return "At least one accepted move is required";
      return null;
    }
    case "board_builder":
      if (!payload.validationType) return "Validation type is required for board builder";
      if (!isValidValidationType(payload.validationType))
        return `Unsupported validation type: ${payload.validationType}`;
      if (!payload.rules) return "Rules object is required for board builder";
      if (!validateRulesForType(payload.validationType, payload.rules))
        return `Invalid rules for validation type ${payload.validationType}`;
      return null;
    default:
      return "Unsupported quiz type";
  }
}



// Create a new quiz
export const createQuiz = async (req, res) => {
  try {
    const body = normalizeQuizBody(req.body);
    const validationError = validateQuizPayload(body);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }
    // Engine‑level validation for board builder quizzes
    // Only run if a FEN is explicitly provided (optional — solutions are stored as piece arrays)
    if (body.type === "board_builder" && body.fen) {
      const engineResult = validateBoardBuilder(body);
      if (!engineResult.ok) {
        return res.status(400).json({ message: `Engine validation failed: ${engineResult.message}` });
      }
    }

    // Solution-level validation for board builder — validates correctSolution and
    // alternateSolutions against the configured rules and piece count.
    // This runs regardless of whether a FEN is present.
    if (body.type === "board_builder") {
      const solutionError = validateBoardBuilderSolution(body);
      if (solutionError) {
        return res.status(400).json({ message: solutionError });
      }
    }

    if (!body.category) {
      return res.status(400).json({ message: "Quiz category is required" });
    }

    const quiz = await QuizModel.create({
      ...body,
      createdBy: req.admin?.id || req.admin?._id,
    });

    return res.status(201).json({
      message: "Quiz created successfully",
      quiz,
    });
  } catch (error) {
    console.error("Error creating quiz:", error);
    if (error.name === "ValidationError") {
      return res.status(400).json({ message: error.message });
    }
    if (error.name === "CastError") {
      return res.status(400).json({ message: `Invalid ${error.path}: ${error.value}` });
    }
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// Get all quizzes
export const getQuizzes = async (req, res) => {
  try {
    const {
      category,
      type,
      page = 1,
      limit = 10,
      search = '',
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;
    let query = {};

    if (category && category !== 'all') query.category = category;
    
    if (type && type !== 'all') {
      if (type === 'text_mcq') {
        query.type = 'mcq';
        query.isBoardBased = { $ne: true };
      } else if (type === 'board_mcq') {
        query.type = 'mcq';
        query.isBoardBased = true;
      } else {
        query.type = type;
      }
    }

    if (search) {
      // Search across both QuizSchema questions and PuzzleSchema titles/descriptions if needed
      query.$or = [
        { questionText: { $regex: search, $options: 'i' } },
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    const skip = (pageNum - 1) * limitNum;

    const allowedSortFields = ['createdAt', 'examUsageCount', 'updatedAt', 'type'];
    const resolvedSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const sortDir = String(sortOrder).toLowerCase() === 'asc' ? 1 : -1;
    const sort =
      resolvedSortBy === 'examUsageCount'
        ? { examUsageCount: sortDir, createdAt: -1 }
        : { [resolvedSortBy]: sortDir };

    const [quizzes, totalCount] = await Promise.all([
      QuizModel.find(query)
        .populate("category", "name")
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      QuizModel.countDocuments(query)
    ]);

    // Ensure examUsageCount is always a number for the admin UI badge.
    const quizzesWithUsage = quizzes.map((q) => ({
      ...q,
      examUsageCount: q.examUsageCount ?? 0,
    }));

    res.status(200).json({
      quizzes: quizzesWithUsage,
      currentPage: pageNum,
      // Never return 0 pages — empty filters should report 1 of 1
      totalPages: Math.max(1, Math.ceil(totalCount / limitNum) || 1),
      totalCount
    });
  } catch (error) {
    console.error("Error fetching quizzes:", error);
    res.status(500).json({ message: "Failed to fetch quizzes", error: error.message });
  }
};

// Get a single quiz by ID
export const getQuizById = async (req, res) => {
  try {
    const { id } = req.params;
    const quiz = await QuizModel.findById(id).populate("category", "name");

    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }

    res.status(200).json(quiz);
  } catch (error) {
    console.error("Error fetching quiz:", error);
    res.status(500).json({ message: "Failed to fetch quiz", error: error.message });
  }
};

// Update a quiz
export const updateQuiz = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = normalizeQuizBody(req.body);

    const quiz = await QuizModel.findById(id);
    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }

    const validationError = validateQuizPayload(updateData);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }
    // Engine‑level validation for board builder updates
    // Only run if a FEN is explicitly provided (optional — solutions are stored as piece arrays)
    if (updateData.type === "board_builder" && updateData.fen) {
      const engineResult = validateBoardBuilder(updateData);
      if (!engineResult.ok) {
        return res.status(400).json({ message: `Engine validation failed: ${engineResult.message}` });
      }
    }

    // Solution-level validation for board builder updates
    if (updateData.type === "board_builder") {
      const solutionError = validateBoardBuilderSolution(updateData);
      if (solutionError) {
        return res.status(400).json({ message: solutionError });
      }
    }

    Object.assign(quiz, updateData);
    await quiz.save();
    invalidateQuizAnswerCache(id).catch(() => {});

    res.status(200).json({
      message: "Quiz updated successfully",
      quiz,
    });
  } catch (error) {
    console.error("Error updating quiz:", error);
    res.status(500).json({ message: "Failed to update quiz", error: error.message });
  }
};

// Delete a quiz
export const deleteQuiz = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if quiz is used in any exams
    const examsUsingQuiz = await ExamModel.findOne({ "chapters.quizIds": id });
    if (examsUsingQuiz) {
      return res.status(400).json({
        message: "Cannot delete quiz because it is used in one or more exams.",
      });
    }

    const quiz = await QuizModel.findByIdAndDelete(id);
    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }

    res.status(200).json({ message: "Quiz deleted successfully" });
  } catch (error) {
    console.error("Error deleting quiz:", error);
    res.status(500).json({ message: "Failed to delete quiz", error: error.message });
  }
};

// Delete multiple quizzes
export const deleteMultipleQuizzes = async (req, res) => {
  try {
    const { quizIds } = req.body;

    if (!Array.isArray(quizIds) || quizIds.length === 0) {
      return res.status(400).json({ message: "quizIds must be a non-empty array" });
    }

    // Check if any of the quizzes are used in exams
    const examsUsingQuizzes = await ExamModel.findOne({
      "chapters.quizIds": { $in: quizIds },
    });
    if (examsUsingQuizzes) {
      return res.status(400).json({
        message: "One or more selected quizzes are used in exams and cannot be deleted.",
      });
    }

    const result = await QuizModel.deleteMany({ _id: { $in: quizIds } });

    res.status(200).json({
      message: `${result.deletedCount} quiz(zes) deleted successfully`,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("Error deleting multiple quizzes:", error);
    res.status(500).json({ message: "Failed to delete quizzes", error: error.message });
  }
};

// Bulk create quizzes from a JSON array (Import)
// Mirrors bulkCreatePuzzles — reuses normalizeQuizBody + validateQuizPayload, no hardcoded fields.
export const bulkCreateQuizzes = async (req, res) => {
  try {
    const quizzes = req.body;

    if (!Array.isArray(quizzes) || quizzes.length === 0) {
      return res.status(400).json({
        message: "Invalid input: Expected a non-empty array of quizzes.",
      });
    }

    const results = {
      total: quizzes.length,
      imported: 0,
      failed: 0,
      errors: [],
    };

    const CHUNK_SIZE = 500;
    const PROCESS_BATCH = 250; // yield to event loop every N records
    let buffer = [];

    for (let i = 0; i < quizzes.length; i += PROCESS_BATCH) {
      const batch = quizzes.slice(i, i + PROCESS_BATCH);

      for (let j = 0; j < batch.length; j++) {
        const rawQuiz = batch[j];
        const globalIndex = i + j + 1;

        // Strip DB-managed fields that must not be copied verbatim
        const { _id, __v, createdAt, updatedAt, createdBy, ...quizPayload } = rawQuiz;

        // Normalize body (handles flat-to-nested field aliasing)
        const body = normalizeQuizBody(quizPayload);

        // Validate using the existing quiz validator
        const validationError = validateQuizPayload(body);
        if (validationError) {
          results.failed++;
          results.errors.push(`Quiz #${globalIndex}: ${validationError}`);
          continue;
        }

        if (!body.category) {
          results.failed++;
          results.errors.push(`Quiz #${globalIndex}: category is required`);
          continue;
        }

        buffer.push({
          ...body,
          createdBy: req.admin?._id || req.admin?.id,
          createdAt: new Date(),
        });

        // Flush buffer when it reaches CHUNK_SIZE
        if (buffer.length === CHUNK_SIZE) {
          try {
            const inserted = await QuizModel.insertMany(buffer, { ordered: false });
            results.imported += inserted.length;
          } catch (insertErr) {
            // insertMany with ordered:false throws but still inserts valid docs
            const inserted = insertErr.result?.nInserted || insertErr.insertedDocs?.length || 0;
            results.imported += inserted;
            results.failed += buffer.length - inserted;
            if (insertErr.writeErrors) {
              insertErr.writeErrors.forEach((we) =>
                results.errors.push(`DB insert error: ${we.errmsg}`)
              );
            }
          }
          buffer = [];
        }
      }

      // Yield to event loop to avoid blocking
      await new Promise((resolve) => setImmediate(resolve));
    }

    // Flush remaining records
    if (buffer.length > 0) {
      try {
        const inserted = await QuizModel.insertMany(buffer, { ordered: false });
        results.imported += inserted.length;
      } catch (insertErr) {
        const inserted = insertErr.result?.nInserted || insertErr.insertedDocs?.length || 0;
        results.imported += inserted;
        results.failed += buffer.length - inserted;
        if (insertErr.writeErrors) {
          insertErr.writeErrors.forEach((we) =>
            results.errors.push(`DB insert error: ${we.errmsg}`)
          );
        }
      }
    }

    res.status(201).json({
      message: `Bulk import completed. Imported: ${results.imported}, Failed: ${results.failed}`,
      results,
    });
  } catch (error) {
    console.error("Error bulk creating quizzes:", error);
    res.status(500).json({
      message: "Internal server error during bulk import",
      error: error.message,
    });
  }
};

// Export all quizzes or a selected subset (by IDs)
// Mirrors exportPuzzles — returns a clean JSON array suitable for re-import.
export const exportQuizzes = async (req, res) => {
  try {
    const { quizIds } = req.body; // optional array of quiz _id strings

    let query = {};
    if (Array.isArray(quizIds) && quizIds.length > 0) {
      query._id = { $in: quizIds };
    }

    // Exclude DB-managed fields that should not be present in an import file
    const projection = {
      _id: 0,
      __v: 0,
      createdBy: 0,
      createdAt: 0,
      updatedAt: 0,
    };

    const quizzes = await QuizModel.find(query, projection)
      .populate("category", "name _id")
      .lean();

    res.status(200).json(quizzes);
  } catch (error) {
    console.error("Error exporting quizzes:", error);
    res.status(500).json({ message: "Failed to export quizzes", error: error.message });
  }
};

// ─── Batch Get Quizzes (Performance Optimization for 100+ concurrent users) ───
/**
 * Fetch multiple quizzes by IDs in a single request.
 * Replaces N individual API calls with 1 batch call, reducing network overhead.
 * Critical for exam loading performance with 50+ questions.
 */
export const batchGetQuizzes = async (req, res) => {
  try {
    const { ids } = req.query;
    
    if (!ids) {
      return res.status(400).json({ message: "Quiz IDs are required" });
    }

    // Parse comma-separated IDs and validate
    const quizIds = ids.split(',').map(id => id.trim()).filter(Boolean);
    
    if (quizIds.length === 0) {
      return res.status(400).json({ message: "No valid quiz IDs provided" });
    }

    if (quizIds.length > 200) {
      return res.status(400).json({ message: "Maximum 200 quizzes per batch request" });
    }

    // Convert to ObjectIds
    const objectIds = quizIds.map(id => {
      try {
        return new mongoose.Types.ObjectId(id);
      } catch (err) {
        return null;
      }
    }).filter(Boolean);

    // Fetch all quizzes in a single query with lean() for performance
    const quizzes = await QuizModel.find(
      { _id: { $in: objectIds } },
      { __v: 0 }
    ).populate("category", "name _id")
     .lean();

    const quizMap = {};
    quizzes.forEach((quiz) => {
      quizMap[quiz._id.toString()] = sanitizeQuizForUser(quiz);
    });

    res.status(200).json({ quizzes: quizMap });
  } catch (error) {
    console.error("Error batch fetching quizzes:", error);
    res.status(500).json({ message: "Failed to fetch quizzes", error: error.message });
  }
};
