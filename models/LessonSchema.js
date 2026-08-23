import mongoose from "mongoose";

// ═══════════════════════════════════════════════════════════════════════════════
// ContentBlock — Polymorphic subdocument embedded inside Lesson.blocks[]
//
// Every content type (text, image, board, quiz, etc.) is a single subdocument
// with a blockType discriminator. The admin builder inserts, reorders, and
// configures these blocks visually. Unknown future fields go into `metadata`.
// ═══════════════════════════════════════════════════════════════════════════════

const ContentBlockSchema = new mongoose.Schema({
  blockType: {
    type: String,
    required: true,
    // All registered block types — extend this enum as new blocks are added
    enum: [
      // Text
      "heading", "paragraph", "coach_tip", "warning_box", "summary", "quote",
      // Media
      "image", "gif", "video", "audio", "pdf_download", "external_link",
      // Chess Board
      "board_static", "board_interactive", "board_autoplay", "board_practice",
      "board_analysis", "game_replay", "pgn_import", "fen_display",
      // Chess Concepts
      "opening_explorer", "move_trainer", "blindfold_mode", "guess_the_move",
      "threat_detection", "endgame_practice",
      // Assessment
      "question_mcq", "question_multi_answer", "question_true_false",
      "question_fill_blank", "question_board_click", "question_move_piece",
      "question_find_checkmate", "question_find_fork", "question_find_pin",
      "question_notation", "question_drag_order", "question_image",
      "question_timed",
      // Layout
      "divider", "spacer", "completion_check", "certificate_trigger",
      // Interactive Practice
      "capture_practice", "promotion_practice", "castling_practice",
      "en_passant_practice",
    ],
  },
  sortOrder: { type: Number, default: 0 },
  isVisible: { type: Boolean, default: true },

  // ═══════ TEXT FIELDS ═══════
  text: {
    content: { type: String, default: "" },        // Markdown / HTML
    variant: { type: String, default: "paragraph" }, // heading|paragraph|callout|coach_tip|warning|summary
    level: { type: Number, default: 2 },           // H1-H6 (for heading variant)
  },

  // ═══════ MEDIA FIELDS ═══════
  media: {
    type: { type: String, default: "" },           // image|gif|video|audio|pdf|external_link
    url: { type: String, default: "" },
    caption: { type: String, default: "" },
    alt: { type: String, default: "" },
    autoplay: { type: Boolean, default: false },
    loop: { type: Boolean, default: false },
    width: { type: String, default: "100%" },
  },

  // ═══════ CHESS BOARD FIELDS ═══════
  board: {
    fen: { type: String, default: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" },
    orientation: { type: String, enum: ["white", "black"], default: "white" },
    mode: { type: String, default: "static" },

    // Visual Overlays
    arrows: [{ from: String, to: String, color: { type: String, default: "#e8a94e" } }],
    highlightSquares: [{ square: String, color: { type: String, default: "rgba(255,255,0,0.4)" } }],
    highlightFiles: [{ type: String }],
    highlightRanks: [{ type: String }],
    highlightDiagonals: [{ start: String, end: String, color: String }],
    glowPieces: [{ square: String, color: String, intensity: Number }],

    // Labels & Annotations
    squareLabels: [{ square: String, text: String }],
    showCoordinates: { type: Boolean, default: true },
    boardTheme: { type: String, default: "default" },
    pieceSet: { type: String, default: "set1" },

    // Auto-Play / Animation Sequence
    moveSequence: [{ type: String }],          // UCI moves: ["e2e4", "e7e5", "g1f3"]
    moveSpeed: { type: Number, default: 600 }, // ms per move
    pauseBetweenMoves: { type: Number, default: 300 },
    autoStart: { type: Boolean, default: true },
    loop: { type: Boolean, default: false },

    // Practice Mode
    practice: {
      expectedMoves: [{ type: String }],
      alternativeMoves: { type: mongoose.Schema.Types.Mixed, default: [] },
      hints: [{ type: String }],
      showSolution: { type: Boolean, default: true },
      validateMode: { type: String, enum: ["strict", "lenient"], default: "strict" },
      successMessage: { type: String, default: "Correct! Well done." },
      failureMessage: { type: String, default: "Not quite. Try again." },
    },

    // Engine Evaluation
    engine: {
      enabled: { type: Boolean, default: false },
      depth: { type: Number, default: 18 },
      showLines: { type: Number, default: 3 },
      showEvalBar: { type: Boolean, default: true },
    },

    // PGN / Game Replay
    pgn: { type: String, default: "" },
    pgnHeaders: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Move Commentary
    moveCommentary: [{
      moveIndex: Number,
      text: String,
      type: { type: String, enum: ["text", "coach_speech", "engine_eval", "important", "question"], default: "text" },
    }],
  },

  // ═══════ QUESTION / ASSESSMENT FIELDS ═══════
  question: {
    type: { type: String, default: "" },
    questionText: { type: String, default: "" },
    explanation: { type: String, default: "" },
    points: { type: Number, default: 10 },
    timeLimit: { type: Number, default: 0 },  // 0 = unlimited

    // Board-based questions
    fen: { type: String, default: "" },
    boardOrientation: { type: String, default: "white" },

    // MCQ / Multi-Answer / True-False
    options: [{
      text: String,
      isCorrect: Boolean,
      image: { type: String, default: "" },
    }],

    // Fill-in-Blank
    correctAnswers: [{ type: String }],
    placeholder: { type: String, default: "" },

    // Board Click
    targetSquares: [{ type: String }],

    // Move Piece
    expectedMove: { type: String, default: "" },
    alternativeMoves: [{ type: String }],

    // Drag-and-Drop Ordering
    orderItems: [{ text: String, correctPosition: Number }],

    // Notation
    notationAnswer: { type: String, default: "" },

    // Extensible
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },

  // ═══════ SPECIAL BLOCKS ═══════
  special: {
    type: { type: String, default: "" },
    content: { type: mongoose.Schema.Types.Mixed, default: null },
  },

  // ═══════ EXTENSIBILITY ═══════
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

}, { _id: true }); // Each block gets its own _id for progress tracking


// ═══════════════════════════════════════════════════════════════════════════════
// Lesson — The core learning unit, composed of ordered ContentBlocks
// ═══════════════════════════════════════════════════════════════════════════════

const LessonSchema = new mongoose.Schema({
  chapter: { type: mongoose.Schema.Types.ObjectId, ref: "Chapter", required: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true },

  title: { type: String, required: true },
  slug: { type: String, default: "" },
  description: { type: String, default: "" },
  thumbnail: { type: String, default: "" },

  // Lesson Type
  type: {
    type: String,
    enum: ["theory", "practice", "quiz", "game_replay", "exercise", "interactive"],
    default: "theory",
  },

  // Content Blocks (the heart of the lesson)
  blocks: [ContentBlockSchema],

  // Settings
  sortOrder: { type: Number, default: 0 },
  estimatedMinutes: { type: Number, default: 10 },
  isPublished: { type: Boolean, default: false },

  // Completion Criteria
  completionType: {
    type: String,
    enum: ["scroll_complete", "all_blocks", "quiz_pass", "practice_complete"],
    default: "all_blocks",
  },
  passingScore: { type: Number, default: 70 },

  // Coach Configuration
  coachName: { type: String, default: "" },
  coachAvatar: { type: String, default: "" },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

LessonSchema.pre("save", function () {
  this.updatedAt = Date.now();
});

// ── Indexes ──────────────────────────────────────────────────────────────────
LessonSchema.index({ chapter: 1, sortOrder: 1 });
LessonSchema.index({ course: 1 });
LessonSchema.index({ slug: 1 });

const LessonModel = mongoose.model("Lesson", LessonSchema);

export default LessonModel;
