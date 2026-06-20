import QuizModel from "../models/QuizSchema.js";
import ExamModel from "../models/ExamSchema.js";

// Helper to validate quiz payload for all supported types
function validateQuizPayload(payload) {
  const { type, isBoardBased, fen, options, pairs, pieceCombination, pieceValue, sequenceOrdering } = payload;
  if (!type) return "Quiz type is required";
  switch (type) {
    case "mcq":
      if (!options || options.length < 2) return "MCQ must have at least 2 options";
      if (!options.some(o => o.isCorrect)) return "MCQ must have at least one correct option";
      if (payload.isBoardBased) {
        if (!fen) return "Board MCQ requires a FEN string";
      }
      return null;
    case "column_matching":
      if (!pairs || pairs.length < 2) return "Column matching must have at least 2 pairs";
      return null;
    case "piece_combination":
      if (!pieceCombination) return "Piece Combination data is required";
      const { targetPiece, slotCount, requiredPieces } = pieceCombination;
      if (!targetPiece) return "targetPiece is required for piece_combination";
      if (!Number.isInteger(slotCount) || slotCount < 1) return "slotCount must be a positive integer";
      if (!Array.isArray(requiredPieces) || requiredPieces.length !== slotCount) return "requiredPieces length must match slotCount";
      return null;
    case "piece_value":
      if (!pieceValue) return "Piece Value data is required";
      const { pieceValues } = pieceValue;
      if (!Array.isArray(pieceValues) || pieceValues.length === 0) return "pieceValues array is required";
      return null;
    case "sequence_ordering":
      if (!sequenceOrdering) return "Sequence Ordering data is required";
      const { sequenceItems } = sequenceOrdering;
      if (!Array.isArray(sequenceItems) || sequenceItems.length < 3) return "At least 3 sequence items are required";
      return null;
    default:
      return "Unsupported quiz type";
  }
}



// Create a new quiz
export const createQuiz = async (req, res) => {
  try {


    const quiz = await QuizModel.create({
      ...req.body,
      createdBy: req.admin._id,
    });

    return res.status(201).json({
      message: "Quiz created successfully",
      quiz,
    });
  } catch (error) {
    console.error("Error creating quiz:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// Get all quizzes
export const getQuizzes = async (req, res) => {
  try {
    const { category, type } = req.query;
    let query = {};

    if (category) query.category = category;
    if (type) query.type = type;

    const quizzes = await QuizModel.find(query)
      .populate("category", "name")
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json(quizzes);
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
    const updateData = req.body;

    const quiz = await QuizModel.findById(id);
    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }

    const validationError = validateQuizPayload(updateData);
    if (validationError) {
      return res.status(400).json({ message: validationError });
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
