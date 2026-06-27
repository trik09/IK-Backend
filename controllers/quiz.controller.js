import QuizModel from "../models/QuizSchema.js";
import ExamModel from "../models/ExamSchema.js";
import { isValidValidationType, validateRulesForType } from "../utils/validationHelper.js";
import { validateBoardBuilder } from "../utils/boardBuilderEngine.js";

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
      if (!payload.instructions) return "Instructions are required for board builder";
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
    const { category, type, page = 1, limit = 10, search = '' } = req.query;
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

    const [quizzes, totalCount] = await Promise.all([
      QuizModel.find(query)
        .populate("category", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      QuizModel.countDocuments(query)
    ]);

    res.status(200).json({
      quizzes,
      currentPage: pageNum,
      totalPages: Math.ceil(totalCount / limitNum),
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

    Object.assign(quiz, updateData);
    await quiz.save();

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
