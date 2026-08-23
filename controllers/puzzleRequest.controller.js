import PuzzleRequest from "../models/PuzzleRequestSchema.js";
import Puzzle from "../models/PuzzleSchema.js";

export const createPuzzleRequest = async (req, res) => {
  try {
    const { title, fen, turnToPlay, solutionMoves } = req.body;
    if (!title || !fen || !solutionMoves) {
      return res.status(400).json({ success: false, message: "Title, FEN position, and solution moves are required." });
    }

    const movesArray = Array.isArray(solutionMoves)
      ? solutionMoves
      : String(solutionMoves).split(/[\s,]+/).filter(Boolean);

    const puzzleReq = await PuzzleRequest.create({
      student: req.user._id,
      title,
      fen,
      turnToPlay: turnToPlay || "w",
      solutionMoves: movesArray,
      status: "pending",
    });

    return res.status(201).json({
      success: true,
      message: "Thank you! Your suggested puzzle has been submitted for Admin approval.",
      data: puzzleReq,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getAdminPuzzleRequests = async (req, res) => {
  try {
    const requests = await PuzzleRequest.find()
      .populate("student", "name email username avatar")
      .sort({ createdAt: -1 });

    return res.json({ success: true, data: requests });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const approvePuzzleRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const pReq = await PuzzleRequest.findById(id);
    if (!pReq) {
      return res.status(404).json({ success: false, message: "Puzzle request not found." });
    }

    pReq.status = "approved";
    await pReq.save();

    // Publish into main Puzzle collection so it appears in the puzzle list!
    const newPuzzle = await Puzzle.create({
      title: pReq.title,
      fen: pReq.fen,
      solutionMoves: pReq.solutionMoves,
      difficulty: "medium",
      level: 2,
      rating: 800,
      type: "normal",
      description: `Suggested by student ${pReq.student?.name || "Community"}`,
    });

    return res.json({
      success: true,
      message: "Puzzle approved and published to official puzzle library!",
      data: { request: pReq, puzzle: newPuzzle },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const rejectPuzzleRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const pReq = await PuzzleRequest.findById(id);
    if (!pReq) {
      return res.status(404).json({ success: false, message: "Puzzle request not found." });
    }

    pReq.status = "rejected";
    await pReq.save();

    return res.json({
      success: true,
      message: "Puzzle request rejected.",
      data: pReq,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
