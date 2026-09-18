
import { Chess, validateFen as rawValidateFen } from "chess.js";

import PuzzleModel from "../models/PuzzleSchema.js";
import ThemeModel from "../models/ThemeSchema.js";
import CompetitionModel from "../models/CompetitionSchema.js";
import EventModel from "../models/EventSchema.js";
import User from "../models/UserSchema.js";
import PuzzleHistoryModel from "../models/PuzzleHistorySchema.js";
import pLimit from 'p-limit';
import { invalidatePuzzleFilterCache } from "../utils/puzzleFilterCache.js";
import { assertPuzzlesNotInActiveEvents } from "../utils/puzzleDeleteGuard.js";
import { invalidateAuthUserCache } from "../utils/userAuthCache.js";


const debugLog = (...args) => {
  if (process.env.NODE_ENV !== "production") {
    console.debug("[PuzzleController]", ...args);
  }
};

const runFenValidation = (fen) => {
  const validators = [
    rawValidateFen,
    Chess?.validateFen,
    Chess?.validate_fen,
  ].filter((fn) => typeof fn === "function");

  for (const validator of validators) {
    const result = validator(fen);
    // debugLog("FEN validator result:", result);
    if (result && typeof result.ok === "boolean") {
      return result;
    }
    if (result && typeof result.valid === "boolean") {
      return { ok: result.valid, error: result.error || result.message };
    }
  }

  return { ok: true };
};

export const validateFen = (fen) => {
  const response = { valid: false, message: "Invalid FEN format" };

  try {
    // debugLog("Raw FEN received:", fen);

    const cleanedFen =
      typeof fen === "string" ? fen.replace(/\s+/g, " ").trim() : "";

    //debugLog("Cleaned FEN:", cleanedFen);

    if (!cleanedFen) {
      return { valid: false, message: "FEN must be a non-empty string" };
    }

    const validation = runFenValidation(cleanedFen);
    if (!validation.ok) {
      //   debugLog("FEN validation failed:", validation);
      return {
        valid: false,
        message: validation.error || "Invalid FEN format",
      };
    }

    const chess = new Chess();
    try {
      chess.load(cleanedFen);
    } catch (loadError) {
      debugLog("Chess.load threw:", loadError?.message);
      return { valid: false, message: loadError.message || response.message };
    }

    return { valid: true, fen: cleanedFen };
  } catch (error) {
    debugLog("validateFen unexpected error:", error);
    return response;
  }
};






export const validateSolutionMoves = (fen, moves = []) => {
  try {
    if (!Array.isArray(moves) || moves.length === 0) {
      return { valid: false, message: "solutionMoves must be a non-empty array" };
    }

    const cleanedFen =
      typeof fen === "string" ? fen.replace(/\s+/g, " ").trim() : "";

    if (!cleanedFen) {
      return {
        valid: false,
        message: "FEN must be provided to validate moves",
      };
    }

    const chess = new Chess();

    // debugLog("validateSolutionMoves - cleaned FEN:", cleanedFen);
    // debugLog("validateSolutionMoves - moves:", moves);

    const fenLoaded = chess.load(cleanedFen);

    if (fenLoaded === false) {
      return { valid: false, message: "Invalid FEN format" };
    }

    // Validate each move
    for (const move of moves) {
      const applied = chess.move(move, { sloppy: true });

      if (!applied) {
        return { valid: false, message: `Invalid move in solution: ${move}` };
      }
    }

    return { valid: true };

  } catch (error) {
    return { valid: false, message: "Invalid solution format" };
  }
};



const createPuzzle = async (req, res) => {
  try {
    const { title, fen, difficulty, solutionMoves, description, category, type, captureConfig, illegalConfig, level, rating, firstMoveBy } = req.body;

    // --- REQUIRED FIELDS CHECK ---
    const missingFields = [];
    if (!title) missingFields.push("title");
    if (!fen) missingFields.push("fen");
    if (!difficulty) missingFields.push("difficulty");
    if (!category) missingFields.push("category");

    if (type === 'capture' && !captureConfig) missingFields.push("captureConfig");

    // Level and Rating are required (schema has default, but good to ensure if sent)
    // Actually schema defaults handle it if missing, but let's check input validity if provided


    if (missingFields.length > 0) {
      return res.status(400).json({
        message: `Missing required fields: ${missingFields.join(", ")}`,
      });
    }

    // --- DIFFICULTY VALIDATION ---
    const allowedDifficulties = ["easy", "medium", "hard"];
    if (!allowedDifficulties.includes(difficulty)) {
      return res.status(400).json({
        message: "Difficulty must be one of: easy, medium, hard",
      });
    }

    // --- LEVEL VALIDATION ---
    if (level && (level < 1 || level > 7)) {
      return res.status(400).json({ message: "Level must be between 1 and 7" });
    }

    // --- FEN VALIDATION --- (skip for illegal/capture types; frontend injects kings usually)
    if (type !== 'illegal' && type !== 'capture') {
      const fenResult = validateFen(fen);
      if (!fenResult.valid) {
        return res.status(400).json({
          message: `FEN Error: ${fenResult.message}`,
        });
      }
    }

    // --- SOLUTION MOVES VALIDATION (Only for Normal Puzzles) ---
    if (!type || type === 'normal') {
      const moveResult = validateSolutionMoves(fen, solutionMoves);
      if (!moveResult.valid) {
        return res.status(400).json({
          message: `Solution Error: ${moveResult.message}`,
        });
      }
    }
    // Illegal and Kids types do not require solution move validation

    // --- CREATE PUZZLE ---
    const puzzleData = {
      title,
      fen,
      difficulty,
      description,
      category,
      createdBy: req.admin._id,
      type: type || 'normal',
      source: 'manual',
      level: level || 1,
      rating: rating || 400,
      firstMoveBy: ['computer', 'w', 'b'].includes(firstMoveBy) ? firstMoveBy : 'human',
      isValidated: true  // single create goes through full chess.js validation
    };

    if (solutionMoves) puzzleData.solutionMoves = solutionMoves;

    // Capture Mode Validation (formerly Kids)
    if (type === 'capture' && captureConfig) {
      if (captureConfig.mode === 'pieces') {
        // Validation for Capture Pieces:
        // 1. Only 1 player piece
        // 2. No piece should be capturable without moving (immediate capture)
        // 3. Maximum number of moves must be specified
        const { piece, startSquare, enemyPieces, playerSide, maximumNoOfMoves } = captureConfig;

        if (!piece || !startSquare) {
          return res.status(400).json({ message: "Capture Pieces mode requires a player piece and start square." });
        }
        if (!enemyPieces || enemyPieces.length === 0) {
          return res.status(400).json({ message: "Capture Pieces mode requires at least one enemy piece." });
        }

        // Validate maximumNoOfMoves
        if (!maximumNoOfMoves || typeof maximumNoOfMoves !== 'number' || maximumNoOfMoves < 1) {
          return res.status(400).json({ 
            message: "Capture Pieces mode requires a valid maximum number of moves (must be a positive number)." 
          });
        }

        // Check for immediate capture
        const chess = new Chess();
        chess.clear();
        try {
          chess.put({ type: piece, color: playerSide || 'w' }, startSquare);
          enemyPieces.forEach(ep => {
            chess.put({ type: ep.type || 'p', color: (playerSide === 'w' ? 'b' : 'w') }, ep.square);
          });

          const legalMoves = chess.moves({ verbose: true });
          const captures = legalMoves.filter(m => m.captured);
          

          if (captures.length > 0) {
            // Check if any capture is possible from the initial square
            // Actually, in the current FEN, since it's player's turn, if they can capture immediately, it's invalid.
            return res.status(400).json({
              message: "Invalid setup: One or more pieces can be captured without moving. Please move them further away."
            });
          }
        } catch (e) {
          console.error("Capture Pieces validation error:", e);
        }
      }

      // Validate maximumNoOfMoves for objects mode as well
      if (captureConfig.mode === 'objects' && captureConfig.maximumNoOfMoves) {
        if (typeof captureConfig.maximumNoOfMoves !== 'number' || captureConfig.maximumNoOfMoves < 1) {
          return res.status(400).json({ 
            message: "Maximum number of moves must be a positive number." 
          });
        }
      }

      puzzleData.captureConfig = captureConfig;
    }

    if (type === 'illegal' && illegalConfig) {
      puzzleData.illegalConfig = illegalConfig;
    }

    const puzzle = await PuzzleModel.create(puzzleData);
    await invalidatePuzzleFilterCache();

    return res.status(201).json({
      message: "Puzzle created successfully",
      puzzle,
    });

  } catch (error) {
    console.error("Error creating puzzle:", error);

    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};


const getPuzzles = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      category = '',
      difficulty = '',
      level = '',
      isDailyTraining = '',
    } = req.query;

    const query = {};
    if (category && category !== 'all') {
      const escapedCategory = category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.category = { $regex: escapedCategory, $options: 'i' };
    }
    if (difficulty && difficulty !== 'all') query.difficulty = difficulty.toLowerCase();
    if (level && level !== 'all') query.level = parseInt(level);
    if (isDailyTraining !== '') query.isDailyTraining = isDailyTraining === 'true';
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { fen: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [puzzles, total] = await Promise.all([
      PuzzleModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      PuzzleModel.countDocuments(query),
    ]);

    res.status(200).json({
      puzzles,
      pagination: {
        current: pageNum,
        total: Math.ceil(total / limitNum),
        limit: limitNum,
        totalRecords: total,
      },
    });
  } catch (error) {
    console.error("Error fetching puzzles:", error);
    res.status(500).json({ message: "Failed to fetch puzzles" });
  }
};

const getPuzzleById = async (req, res) => {
  try {
    const { id } = req.params;
    const puzzle = await PuzzleModel.findById(id);

    if (!puzzle) {
      return res.status(404).json({ message: "Puzzle not found" });
    }

    res.status(200).json(puzzle);
  } catch (error) {
    console.error("Error fetching puzzle:", error);
    res.status(500).json({ message: "Failed to fetch puzzle" });
  }
};

const updatePuzzle = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };

    const puzzle = await PuzzleModel.findById(id);

    if (!puzzle) {
      return res.status(404).json({
        message: "Puzzle not found",
      });
    }

    // Normalize difficulty to match enum values
    if (updates.difficulty) {
      updates.difficulty = updates.difficulty.toLowerCase();
    }

    // Determine the puzzle type after update
    const puzzleType = updates.type || puzzle.type || "normal";

    // Use updated FEN if provided
    const fenToValidate = updates.fen || puzzle.fen;

    // Validate FEN — skip strict chess.js rules for capture/illegal
    // (emoji targets on e1/e8 use placeholders; phantom kings are injected).
    if (updates.fen && puzzleType !== "illegal" && puzzleType !== "capture") {
      const fenValidation = validateFen(updates.fen);

      if (!fenValidation.valid) {
        return res.status(400).json({
          message: fenValidation.message,
        });
      }
    }

    // Validate solution moves ONLY for normal puzzles
    if (puzzleType === "normal" && updates.solutionMoves) {
      const solutionValidation = validateSolutionMoves(
        fenToValidate,
        updates.solutionMoves
      );

      if (!solutionValidation.valid) {
        return res.status(400).json({
          message: solutionValidation.message,
        });
      }
    }

    // Validate alternative solutions ONLY for normal puzzles
    if (
      puzzleType === "normal" &&
      Array.isArray(updates.alternativeSolutions)
    ) {
      for (const altSol of updates.alternativeSolutions) {
        if (Array.isArray(altSol) && altSol.length > 0) {
          const altResult = validateSolutionMoves(fenToValidate, altSol);

          if (!altResult.valid) {
            return res.status(400).json({
              message: `Alternative Solution Error: ${altResult.message}`,
            });
          }
        }
      }
    }

    // Update puzzle fields
    Object.assign(puzzle, updates);

    await puzzle.save();
    await invalidatePuzzleFilterCache();

    return res.status(200).json({
      message: "Puzzle updated successfully",
      puzzle,
    });
  } catch (error) {
    console.error("Error updating puzzle:", error);

    return res.status(500).json({
      message: "Failed to update puzzle",
      error: error.message,
      validationErrors: error.errors || null,
    });
  }
};

const deletePuzzle = async (req, res) => {
  try {
    const { id } = req.params;

    const blocked = await assertPuzzlesNotInActiveEvents([id]);
    if (blocked) {
      return res.status(400).json({
        message: blocked.message,
        usages: blocked.usages,
        blockedPuzzleIds: blocked.blockedPuzzleIds,
      });
    }

    const puzzle = await PuzzleModel.findByIdAndDelete(id);

    if (!puzzle) {
      return res.status(404).json({ message: "Puzzle not found" });
    }

    await invalidatePuzzleFilterCache();
    res.status(200).json({ message: "Puzzle deleted successfully" });
  } catch (error) {
    console.error("Error deleting puzzle:", error);
    res.status(500).json({ message: "Failed to delete puzzle" });
  }
};


// Get puzzles with filters (source, category, rating, search)
const getPuzzlesWithFilters = async (req, res) => {
  try {
    const {
      source,
      category,
      minRating,
      maxRating,
      search,
      type, // 'normal' or 'capture' or 'illegal'
      page = 1,
      limit = 20
    } = req.query;

    const query = {};

    if (source) query.source = source;
    if (category) query.category = category;
    if (type) query.type = type;

    // Rating filters removed as Rating is deprecated/removed

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const puzzles = await PuzzleModel.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await PuzzleModel.countDocuments(query);

    res.status(200).json({
      puzzles,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching puzzles with filters:', error);
    res.status(500).json({ message: 'Failed to fetch puzzles' });
  }
};

// Get puzzle statistics
const getPuzzleStats = async (req, res) => {
  try {
    const stats = await PuzzleModel.aggregate([
      {
        $group: {
          _id: '$type', // Group by type instead of source
          count: { $sum: 1 }
        }
      }
    ]);

    const categoryStats = await PuzzleModel.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      }
    ]);

    res.status(200).json({
      byType: stats,
      byCategory: categoryStats
    });
  } catch (error) {
    console.error('Error fetching puzzle stats:', error);
    res.status(500).json({ message: 'Failed to fetch statistics' });
  }
};

// Get random puzzle from Local DB (Replaces Lichess Proxy)
const getRandomPuzzle = async (req, res) => {
  try {
    // Get a random puzzle from the database
    // Optionally filter by type 'normal' if kids should be separate casual mode?
    // User said "in casual puzzle... remove that lichess... in kids type admin will choose...". 
    // Implies Casual Puzzle might serve both or user chooses. 
    // For now, let's fetch a random puzzle of ANY type, or maybe default to 'normal' unless specified.
    // Let's stick to 'normal' for default casual puzzle flow if not specified, OR just random.
    // Given the prompt "Casual Puzzle you can see its taking from lichess remove that", 
    // I should return a local puzzle.

    const { type } = req.query;
    const filter = {};
    if (type) {
      filter.type = type;
    }

    const count = await PuzzleModel.countDocuments(filter);
    if (count === 0) {
      return res.status(404).json({ message: "No puzzles available" });
    }

    const random = Math.floor(Math.random() * count);
    const puzzle = await PuzzleModel.findOne(filter).skip(random);

    if (!puzzle) {
      return res.status(404).json({ message: "No puzzles available" });
    }

    res.status(200).json(puzzle);
  } catch (error) {
    console.error('Error fetching random puzzle:', error);
    res.status(500).json({
      message: 'Failed to fetch random puzzle',
      error: error.message
    });
  }
};


const LEVEL_RANGES = {
  1: { easy: [300, 450], medium: [450, 600], hard: [600, 750] },
  2: { easy: [750, 900], medium: [900, 1050], hard: [1050, 1200] },
  3: { easy: [1200, 1350], medium: [1350, 1500], hard: [1500, 1650] },
  4: { easy: [1650, 1800], medium: [1800, 1950], hard: [1950, 2100] },
  5: { easy: [2100, 2250], medium: [2250, 2400], hard: [2400, 2550] },
  6: { easy: [2550, 2700], medium: [2700, 2850], hard: [2850, 3000] },
  7: { easy: [3000, 3160], medium: [3160, 3330], hard: [3330, 3500] }
};

const determineLevelAndDifficulty = (rating) => {
  const r = Number(rating);
  for (const [lvl, ranges] of Object.entries(LEVEL_RANGES)) {
    if (r >= ranges.easy[0] && r <= ranges.hard[1]) {
      if (r <= ranges.easy[1]) return { level: Number(lvl), difficulty: 'easy' };
      if (r <= ranges.medium[1]) return { level: Number(lvl), difficulty: 'medium' };
      return { level: Number(lvl), difficulty: 'hard' };
    }
  }
  // Fallback if out of bounds
  if (r < 300) return { level: 1, difficulty: 'easy' };
  if (r > 3500) return { level: 7, difficulty: 'hard' };
  return { level: 1, difficulty: 'medium' };
};

const bulkCreatePuzzles = async (req, res) => {
  try {
    const puzzles = req.body;

    if (!Array.isArray(puzzles) || puzzles.length === 0) {
      return res.status(400).json({
        message: "Invalid input: Expected a non-empty array of puzzles."
      });
    }

    const results = {
      total: puzzles.length,
      imported: 0,
      failed: 0,
      errors: []
    };

    // Fast structural FEN check
    const isFenStructurallyValid = (fen) => {
      if (typeof fen !== 'string' || !fen.trim()) return false;
      const parts = fen.trim().split(/\s+/);
      if (parts.length < 1) return false;
      const rows = parts[0].split('/');
      return rows.length === 8;
    };

    const CHUNK_SIZE = 1000;
    const PROCESS_BATCH = 500; // for event loop yielding
    let buffer = [];

    for (let i = 0; i < puzzles.length; i += PROCESS_BATCH) {
      const batch = puzzles.slice(i, i + PROCESS_BATCH);

      for (let j = 0; j < batch.length; j++) {
        const puzzle = batch[j];
        let {
          title,
          fen,
          difficulty,
          solutionMoves,
          category,
          type = 'normal',
          rating,
          level
        } = puzzle;

        // Auto-calculate level/difficulty
        if (rating && (!difficulty || !level)) {
          const calculated = determineLevelAndDifficulty(rating);
          if (!level) level = calculated.level;
          if (!difficulty) difficulty = calculated.difficulty;
        }

        if (!title || !fen || !category) {
          results.failed++;
          results.errors.push(
            `Puzzle #${i + j + 1}: Missing required fields (title, fen, or category)`
          );
          continue;
        }

        if (!difficulty) {
          results.failed++;
          results.errors.push(
            `Puzzle #${i + j + 1} (${title}): Difficulty is missing and could not be calculated from Rating.`
          );
          continue;
        }

        if (!isFenStructurallyValid(fen)) {
          results.failed++;
          results.errors.push(
            `Puzzle #${i + j + 1} (${title}): Invalid FEN structure`
          );
          continue;
        }

        // Build puzzle object (same logic)
        buffer.push({
          title,
          fen: fen.trim(),
          difficulty,
          category,
          solutionMoves,
          alternativeSolutions: puzzle.alternativeSolutions,
          description: puzzle.description,
          type,
          level: level || 1,
          rating: rating || 400,
          captureConfig: puzzle.captureConfig,
          illegalConfig: puzzle.illegalConfig,
          initialMove: undefined,
          firstMoveBy:
            ['computer', 'w', 'b'].includes(puzzle.firstMoveBy) ? puzzle.firstMoveBy : 'human',
          createdBy: req.admin._id,
          source: 'manual',
          createdAt: new Date()
        });

        // Insert when buffer full
        if (buffer.length === CHUNK_SIZE) {
          await PuzzleModel.insertMany(buffer, { ordered: false });
          results.imported += buffer.length;
          buffer = [];
        }
      }

      // Yield to event loop (VERY IMPORTANT)
      await new Promise((resolve) => setImmediate(resolve));
    }

    // Insert remaining
    if (buffer.length > 0) {
      await PuzzleModel.insertMany(buffer, { ordered: false });
      results.imported += buffer.length;
    }

    if (results.imported > 0) {
      await invalidatePuzzleFilterCache();
    }

    res.status(201).json({
      message: `Bulk import completed. Imported: ${results.imported}, Failed: ${results.failed}`,
      results
    });

  } catch (error) {
    console.error("Error bulk creating puzzles:", error);
    res.status(500).json({
      message: "Internal server error during bulk import",
      error: error.message
    });
  }
};




// Export all puzzles or selected puzzles
const exportPuzzles = async (req, res) => {
  try {
    const { puzzleIds } = req.body; // Array of puzzle IDs to export (optional)
    
    let query = {};
    
    // If specific puzzle IDs are provided, filter by them
    if (puzzleIds && Array.isArray(puzzleIds) && puzzleIds.length > 0) {
      query._id = { $in: puzzleIds };
    }
    
    const puzzles = await PuzzleModel.find(query, {
      _id: 0,
      title: 1,
      fen: 1,
      difficulty: 1,
      category: 1,
      solutionMoves: 1,
      alternativeSolutions: 1,
      description: 1,
      type: 1,
      level: 1,
      rating: 1,
      captureConfig: 1,
      illegalConfig: 1,
      firstMoveBy: 1
    });

    res.status(200).json(puzzles);
  } catch (error) {
    console.error("Error exporting puzzles:", error);
    res.status(500).json({ message: "Failed to export puzzles" });
  }
};

// Delete all puzzles
const deleteAllPuzzles = async (req, res) => {
  try {
    const result = await PuzzleModel.deleteMany({});
    if (result.deletedCount > 0) {
      await invalidatePuzzleFilterCache();
    }
    res.status(200).json({
      message: `Successfully deleted ${result.deletedCount} puzzles`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error("Error deleting all puzzles:", error);
    res.status(500).json({ message: "Failed to delete all puzzles" });
  }
};
// Delete multiple puzzles
const deleteMultiplePuzzles = async (req, res) => {
  try {
    const { puzzleIds } = req.body;
    if (!Array.isArray(puzzleIds) || puzzleIds.length === 0) {
      return res.status(400).json({ message: "No puzzle IDs provided" });
    }

    const blocked = await assertPuzzlesNotInActiveEvents(puzzleIds);
    if (blocked) {
      return res.status(400).json({
        message: blocked.message,
        usages: blocked.usages,
        blockedPuzzleIds: blocked.blockedPuzzleIds,
      });
    }

    const result = await PuzzleModel.deleteMany({ _id: { $in: puzzleIds } });
    if (result.deletedCount > 0) {
      await invalidatePuzzleFilterCache();
    }
    res.status(200).json({
      message: `Successfully deleted ${result.deletedCount} puzzles`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error("Error deleting multiple puzzles:", error);
    res.status(500).json({ message: "Failed to delete puzzles" });
  }
};

// Validate all puzzles in DB using chess.js — runs as a background scan
// Only scans puzzles where isValidated: false (newly imported ones)
// Marks valid ones as isValidated: true, keeps invalid ones as false


const validatePuzzles = async (req, res) => {
  try {
    const BATCH = 300;
    const CONCURRENCY = 20;

    const limit = pLimit(CONCURRENCY);

    const invalid = [];
    let total = 0;

    // Cursor instead of loading everything in memory
    const cursor = PuzzleModel.find(
      { isValidated: false },
      '_id title fen solutionMoves type'
    ).lean().cursor();

    let batch = [];

    // Helper function to process each batch
    const processBatch = async (batch) => {
      const validIds = [];

      const results = await Promise.all(
        batch.map((puzzle) =>
          limit(async () => {
            const reasons = [];

            const fenResult = validateFen(puzzle.fen);
            if (!fenResult.valid) {
              reasons.push(`Invalid FEN: ${fenResult.message}`);
            } else if (puzzle.type !== 'kids' && puzzle.type !== 'capture') {
              const moveResult = validateSolutionMoves(
                puzzle.fen,
                puzzle.solutionMoves
              );

              if (!moveResult.valid) {
                reasons.push(`Invalid solution: ${moveResult.message}`);
              }
            }

            return reasons.length > 0
              ? {
                _id: puzzle._id,
                title: puzzle.title,
                reasons,
                valid: false
              }
              : { _id: puzzle._id, valid: true };
          })
        )
      );

      // Separate valid & invalid
      for (const item of results) {
        if (item.valid) {
          validIds.push(item._id);
        } else {
          invalid.push({
            _id: item._id,
            title: item.title,
            reasons: item.reasons
          });
        }
      }

      // Update DB per batch (important optimization)
      if (validIds.length > 0) {
        await PuzzleModel.updateMany(
          { _id: { $in: validIds } },
          { $set: { isValidated: true } }
        );
      }
    };

    // Stream processing
    for await (const puzzle of cursor) {
      batch.push(puzzle);
      total++;

      if (batch.length === BATCH) {
        await processBatch(batch);
        batch = [];

        // Yield event loop
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    // Process remaining
    if (batch.length > 0) {
      await processBatch(batch);
    }

    // If nothing found
    if (total === 0) {
      return res.status(200).json({
        total: 0,
        invalidCount: 0,
        invalid: [],
        message: 'All puzzles are already validated. Nothing new to scan.'
      });
    }

    res.status(200).json({
      total,
      invalidCount: invalid.length,
      invalid
    });

  } catch (error) {
    console.error('Error validating puzzles:', error);
    res.status(500).json({
      message: 'Validation failed',
      error: error.message
    });
  }
};

// Get puzzle IDs matching filters (for select all functionality)
const getPuzzleIds = async (req, res) => {
  try {
    const {
      search = '',
      category = '',
      difficulty = '',
      level = '',
      isDailyTraining = '',
    } = req.query;

    const query = {};
    if (category && category !== 'all') {
      const escapedCategory = category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.category = { $regex: escapedCategory, $options: 'i' };
    }
    if (difficulty && difficulty !== 'all') query.difficulty = difficulty.toLowerCase();
    if (level && level !== 'all') query.level = parseInt(level);
    if (isDailyTraining !== '') query.isDailyTraining = isDailyTraining === 'true';
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { fen: { $regex: search, $options: 'i' } },
      ];
    }

    const puzzleIds = await PuzzleModel.find(query).select('_id').lean();
    const ids = puzzleIds.map(p => p._id.toString());

    res.status(200).json({ puzzleIds: ids });
  } catch (error) {
    console.error("Error fetching puzzle IDs:", error);
    res.status(500).json({ message: "Failed to fetch puzzle IDs" });
  }
};

// Delete all puzzles that fail chess.js validation
const deleteInvalidPuzzles = async (req, res) => {
  try {
    const { puzzleIds } = req.body;
    if (!Array.isArray(puzzleIds) || puzzleIds.length === 0) {
      return res.status(400).json({ message: 'No puzzle IDs provided' });
    }

    const blocked = await assertPuzzlesNotInActiveEvents(puzzleIds);
    if (blocked) {
      return res.status(400).json({
        message: blocked.message,
        usages: blocked.usages,
        blockedPuzzleIds: blocked.blockedPuzzleIds,
      });
    }

    const result = await PuzzleModel.deleteMany({ _id: { $in: puzzleIds } });
    if (result.deletedCount > 0) {
      await invalidatePuzzleFilterCache();
    }
    res.status(200).json({
      message: `Deleted ${result.deletedCount} invalid puzzles`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error deleting invalid puzzles:', error);
    res.status(500).json({ message: 'Failed to delete invalid puzzles' });
  }
};

const toggleDailyTraining = async (req, res) => {
  try {
    const { id } = req.params;
    const { isDailyTraining } = req.body;

    const puzzle = await PuzzleModel.findById(id);
    if (!puzzle) {
      return res.status(404).json({ message: "Puzzle not found" });
    }

    puzzle.isDailyTraining = isDailyTraining;
    await puzzle.save();

    res.status(200).json({ message: "Puzzle daily training status updated", puzzle });
  } catch (error) {
    console.error("Error toggling daily training:", error);
    res.status(500).json({ message: "Failed to toggle daily training" });
  }
};

const getQcfyPuzzle = async (req, res) => {
  try {
    const { themeId, difficulty, excludeIds } = req.query;

    let candidatePuzzleIds = null;
    let themeTitle = "All Themes (Random Adaptive)";

    if (themeId && themeId !== "all") {
      let theme;
      if (themeId.match(/^[0-9a-fA-F]{24}$/)) {
        theme = await ThemeModel.findById(themeId);
      } else {
        theme = await ThemeModel.findOne({ name: themeId });
      }

      if (theme) {
        themeTitle = theme.title || theme.name;
        candidatePuzzleIds = (theme.puzzles || []).map((id) => id.toString());
      }
    }

    // Build query
    const query = {
      type: { $in: ["normal", "capture", "illegal"] }
    };

    if (candidatePuzzleIds !== null) {
      if (candidatePuzzleIds.length === 0) {
        return res.status(200).json({
          success: false,
          message: "No puzzles found in this theme yet.",
          totalAvailable: 0,
          themeTitle
        });
      }
      query._id = { $in: candidatePuzzleIds };
    }

    // Exclude recent puzzle IDs if provided to avoid repeating the immediate same puzzle
    if (excludeIds) {
      const excluded = (Array.isArray(excludeIds) ? excludeIds : excludeIds.split(","))
        .map((id) => id.trim())
        .filter((id) => id.match(/^[0-9a-fA-F]{24}$/));

      if (excluded.length > 0) {
        if (query._id) {
          query._id = { ...query._id, $nin: excluded };
        } else {
          query._id = { $nin: excluded };
        }
      }
    }

    // Filter by userRating and difficulty if provided
    const userRatingNum = Number(req.query.userRating);
    const hasUserRating = !isNaN(userRatingNum) && userRatingNum > 0;

    if (hasUserRating && difficulty && difficulty !== "all") {
      const diffLower = difficulty.toLowerCase();
      let minR, maxR;
      if (diffLower === "easy") {
        minR = Math.max(100, userRatingNum - 100);
        maxR = userRatingNum;
      } else if (diffLower === "hard") {
        minR = userRatingNum + 100;
        maxR = userRatingNum + 200;
      } else {
        // standard / medium
        minR = userRatingNum;
        maxR = userRatingNum + 100;
      }
      query.rating = { $gte: minR, $lte: maxR };
    } else if (difficulty && difficulty !== "all") {
      const diffLower = difficulty.toLowerCase();
      if (diffLower === "easy") {
        query.$or = [
          { difficulty: "easy" },
          { level: { $in: [1, 2] } },
          { rating: { $lt: 1000 } }
        ];
      } else if (diffLower === "hard") {
        query.$or = [
          { difficulty: "hard" },
          { level: { $gte: 5 } },
          { rating: { $gte: 1400 } }
        ];
      } else if (diffLower === "standard" || diffLower === "medium") {
        query.$or = [
          { difficulty: "medium" },
          { level: { $in: [3, 4] } },
          { rating: { $gte: 1000, $lt: 1400 } }
        ];
      }
    }

    let totalCount = await PuzzleModel.countDocuments(query);

    // If no puzzles found with rating range, expand rating bracket by +/- 200
    if (totalCount === 0 && query.rating && hasUserRating) {
      delete query.rating;
      query.rating = {
        $gte: Math.max(100, userRatingNum - 250),
        $lte: userRatingNum + 250
      };
      totalCount = await PuzzleModel.countDocuments(query);
    }

    // If still 0, delete rating filter entirely
    if (totalCount === 0 && query.rating) {
      delete query.rating;
      totalCount = await PuzzleModel.countDocuments(query);
    }

    // If no puzzles found with exclude filter, retry without exclude filter
    if (totalCount === 0 && excludeIds) {
      delete query._id;
      if (candidatePuzzleIds !== null) {
        query._id = { $in: candidatePuzzleIds };
      }
      totalCount = await PuzzleModel.countDocuments(query);
    }

    // If still 0 and a specific difficulty was requested, fallback to any difficulty
    if (totalCount === 0 && query.$or) {
      delete query.$or;
      totalCount = await PuzzleModel.countDocuments(query);
    }

    if (totalCount === 0) {
      return res.status(200).json({
        success: false,
        message: "No matching puzzles found.",
        totalAvailable: 0,
        themeTitle
      });
    }

    // Pick random puzzle
    const randomSkip = Math.floor(Math.random() * totalCount);
    const puzzle = await PuzzleModel.findOne(query).skip(randomSkip).lean();

    return res.status(200).json({
      success: true,
      puzzle,
      totalAvailable: totalCount,
      themeTitle
    });
  } catch (error) {
    console.error("Error fetching QCFY puzzle:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error fetching puzzle",
      error: error.message
    });
  }
};

/**
 * Sets user's initial rating choice:
 * beginner -> 400
 * intermediate -> 1000
 * advanced -> 1600
 */
const setQcfyInitialRating = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const { level } = req.body;
    let initialRating = 1000;
    if (level === 'beginner') initialRating = 400;
    else if (level === 'intermediate') initialRating = 1000;
    else if (level === 'advanced') initialRating = 1600;
    else if (typeof level === 'number') initialRating = Math.max(100, Math.min(3000, Math.round(level)));

    const user = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          puzzleRating: initialRating,
          puzzleInitialLevelSet: true,
          puzzlePuzzlesAttempted: 0,
          puzzlePuzzlesSolved: 0
        }
      },
      { new: true }
    ).select('-password');

    invalidateAuthUserCache(userId);

    return res.status(200).json({
      success: true,
      message: `Initial rating set to ${initialRating}`,
      user
    });
  } catch (error) {
    console.error("Error setting initial puzzle rating:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error setting initial rating",
      error: error.message
    });
  }
};

/**
 * Updates player puzzle rating using Glicko/Elo system with provisional phase:
 * - Solved: delta > 0 (scaled by difficulty difference)
 * - Failed: delta < 0 (scaled by difficulty difference)
 * - Provisional: K = 40 to 60 for first 10 puzzles
 * - Established: K = 20
 */
const updateQcfyRating = async (req, res) => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }

    const { puzzleId, outcome, timeSpent = 0 } = req.body;
    if (!puzzleId || !['solved', 'failed'].includes(outcome)) {
      return res.status(400).json({ success: false, message: "Invalid puzzle outcome or missing puzzleId" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const puzzle = await PuzzleModel.findById(puzzleId).lean();
    if (!puzzle) {
      return res.status(404).json({ success: false, message: "Puzzle not found" });
    }

    // Current player rating (fallback to 1000 if null)
    const currentRating = user.puzzleRating !== null && user.puzzleRating !== undefined
      ? user.puzzleRating
      : 1000;

    // Puzzle rating (fallback from level or default 800)
    const puzzleRating = puzzle.rating || (puzzle.level ? 600 + (puzzle.level - 1) * 200 : 800);

    const attempts = user.puzzlePuzzlesAttempted || 0;
    const isProvisional = attempts < 10;

    // K-factor schedule:
    // Provisional (attempts < 10): K is high (40 to 60) for fast convergence
    // Established (attempts >= 10): K is stable at 20
    const K = isProvisional ? (40 + (10 - attempts) * 2) : 20;

    // Glicko/Elo Expected Score
    const expectedScore = 1 / (1 + Math.pow(10, (puzzleRating - currentRating) / 400));
    const actualScore = outcome === 'solved' ? 1 : 0;

    let delta = Math.round(K * (actualScore - expectedScore));

    // Guarantee minimum movement
    if (outcome === 'solved') {
      delta = Math.max(2, delta);
    } else {
      delta = Math.min(-2, delta);
    }

    const newRating = Math.max(100, currentRating + delta);

    user.puzzleRating = newRating;
    user.puzzlePuzzlesAttempted = attempts + 1;
    if (outcome === 'solved') {
      user.puzzlePuzzlesSolved = (user.puzzlePuzzlesSolved || 0) + 1;
    }
    user.puzzleInitialLevelSet = true;
    await user.save();

    invalidateAuthUserCache(userId);

    // Also record in PuzzleHistoryModel for platform consistency
    try {
      await PuzzleHistoryModel.create({
        puzzleId: puzzle._id,
        userId: user._id,
        isSolved: outcome === 'solved',
        usedHints: 0,
        attempts: 1,
        timeTaken: timeSpent
      });
    } catch (histErr) {
      console.error("Failed to log puzzle history:", histErr);
    }

    return res.status(200).json({
      success: true,
      oldRating: currentRating,
      newRating,
      delta,
      isProvisional: (user.puzzlePuzzlesAttempted < 10),
      puzzlesAttempted: user.puzzlePuzzlesAttempted,
      puzzlesSolved: user.puzzlePuzzlesSolved
    });
  } catch (error) {
    console.error("Error updating QCFY rating:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error updating rating",
      error: error.message
    });
  }
};

export {
  createPuzzle,
  getPuzzles,
  getPuzzleById,
  updatePuzzle,
  deletePuzzle,
  deleteAllPuzzles,
  getPuzzlesWithFilters,
  getPuzzleStats,
  getRandomPuzzle,
  bulkCreatePuzzles,
  exportPuzzles,
  deleteMultiplePuzzles,
  validatePuzzles,
  deleteInvalidPuzzles,
  toggleDailyTraining,
  getPuzzleIds,
  getQcfyPuzzle,
  setQcfyInitialRating,
  updateQcfyRating
};