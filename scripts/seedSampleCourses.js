import mongoose from "mongoose";
import dotenv from "dotenv";
import CourseCategory from "../models/CourseCategorySchema.js";
import Course from "../models/CourseSchema.js";
import Chapter from "../models/ChapterSchema.js";
import Lesson from "../models/LessonSchema.js";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/qcfy-chess";

async function seedProductionCurriculum() {
  try {
    console.log("Connecting to MongoDB for seeding...");
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB!");

    // Clear existing course data to rebuild fresh
    await Promise.all([
      CourseCategory.deleteMany({}),
      Course.deleteMany({}),
      Chapter.deleteMany({}),
      Lesson.deleteMany({}),
    ]);
    console.log("Cleared existing course catalog!");

    // Create Category
    const category = await CourseCategory.create({
      name: "Chess Fundamentals",
      slug: "chess-fundamentals",
      description: "Master the rules, history, piece movements, and basic tactics of chess.",
      icon: "FaGraduationCap",
      color: "#b58863",
      isPublished: true,
    });

    // Create Main Course
    const course = await Course.create({
      title: "Chess Fundamentals: Complete Beginner Academy",
      slug: "chess-fundamentals",
      subtitle: "From your very first move to tactical mastery. The ultimate guided curriculum.",
      description: "Learn chess from scratch! Discover the fascinating history, understand the board, master how each piece moves, and execute powerful tactics like forks, pins, and skewers.",
      category: category._id,
      level: "beginner",
      accessLevel: "free",
      estimatedHours: 4,
      xpReward: 500,
      tags: ["Beginner", "Fundamentals", "Tactics", "Piece Movement"],
      outcomes: [
        "Understand the history and evolution of chess",
        "Master algebraic coordinates and board setup",
        "Move and capture with all 6 chess pieces with confidence",
        "Execute special rules: Castling, Promotion, and En Passant",
        "Identify and apply core tactical motifs: Checkmate, Pins, Forks, and Skewers",
      ],
      isPublished: true,
      publishedAt: new Date(),
    });

    // ── CHAPTER 1: History of Chess ──────────────────────────────────────────
    const ch1 = await Chapter.create({
      course: course._id,
      title: "Chapter 1: History & Origins of Chess",
      description: "Explore the ancient origins, evolution, and legendary trivia of the royal game.",
      sortOrder: 1,
    });

    const l1_1 = await Lesson.create({
      course: course._id,
      chapter: ch1._id,
      title: "The Origin of Chess",
      slug: "origin-of-chess",
      type: "theory",
      estimatedMinutes: 8,
      xpReward: 25,
      sortOrder: 1,
      isPublished: true,
      blocks: [
        {
          blockType: "heading",
          content: "The Ancient Roots of Chess",
          config: { level: 1 },
        },
        {
          blockType: "paragraph",
          content: "Chess is one of the oldest and most popular board games in human history. It originated in Northern India during the Gupta Empire around the 6th century AD, where it was known as 'Chaturanga' (meaning 'four divisions of the military': infantry, cavalry, elephants, and chariots).",
        },
        {
          blockType: "coach_tip",
          content: "Did you know? The original pieces in Chaturanga represented ancient army divisions: Pawns (Infantry), Knights (Cavalry), Bishops (Elephants), and Rooks (Chariots)!",
          config: { title: "Coach Insight", avatar: "coach" },
        },
        {
          blockType: "image",
          content: "https://images.unsplash.com/photo-1529699211952-734e80c4d42b?auto=format&fit=crop&w=1000&q=80",
          config: { caption: "Ancient carved chess pieces depicting traditional army figures." },
        },
        {
          blockType: "summary",
          content: "Key Takeaway: Chess originated in 6th-century India as Chaturanga before spreading across Persia, the Islamic world, and medieval Europe.",
        },
      ],
    });

    const l1_2 = await Lesson.create({
      course: course._id,
      chapter: ch1._id,
      title: "Evolution of Modern Chess Rules",
      slug: "evolution-of-chess-rules",
      type: "theory",
      estimatedMinutes: 8,
      xpReward: 25,
      sortOrder: 2,
      isPublished: true,
      blocks: [
        {
          blockType: "heading",
          content: "How Chess Evolved into the Modern Game",
          config: { level: 1 },
        },
        {
          blockType: "paragraph",
          content: "When Chaturanga reached Persia around 600 AD, it was named 'Shatranj'. Players declared 'Shāh!' (Persian for King) when attacking the king, and 'Shāh māt!' (the King is helpless) when the king could not escape—the origin of our modern word 'Checkmate'!",
        },
        {
          blockType: "paragraph",
          content: "In 15th-century Southern Europe, the rules underwent a dramatic transformation known as 'Mad Queen's Chess'. The Queen and Bishop gained powerful long-range moves, accelerating the pace of games dramatically.",
        },
        {
          blockType: "warning_box",
          content: "Before 1475, the Queen was one of the weakest pieces on the board! The rule change made her the ultimate power piece we know today.",
        },
      ],
    });

    const l1_3 = await Lesson.create({
      course: course._id,
      chapter: ch1._id,
      title: "Modern Chess & World Champions",
      slug: "modern-chess-and-champions",
      type: "theory",
      estimatedMinutes: 10,
      xpReward: 30,
      sortOrder: 3,
      isPublished: true,
      blocks: [
        {
          blockType: "heading",
          content: "The Golden Era of World Champions",
          config: { level: 1 },
        },
        {
          blockType: "paragraph",
          content: "The International Chess Federation (FIDE) was founded in Paris in 1924 to govern global competitions. Official World Championship matches began in 1886 when Wilhelm Steinitz defeated Johannes Zukertort.",
        },
        {
          blockType: "coach_tip",
          content: "Legendary champions like Garry Kasparov, Bobby Fischer, Viswanathan Anand, and Magnus Carlsen revolutionized chess strategy through deep calculation and psychological preparation.",
          config: { title: "Grandmaster Wisdom" },
        },
        {
          blockType: "question_mcq",
          content: "In which country did the predecessor of chess (Chaturanga) originate?",
          config: {
            options: [
              { label: "India", isCorrect: true, explanation: "Correct! Chaturanga originated in India during the 6th century Gupta Empire." },
              { label: "Persia", isCorrect: false, explanation: "Persia adopted the game as Shatranj from India." },
              { label: "Greece", isCorrect: false, explanation: "Chess was brought to Europe much later." },
              { label: "China", isCorrect: false, explanation: "Xiangqi developed separately in China." },
            ],
          },
        },
      ],
    });

    const l1_4 = await Lesson.create({
      course: course._id,
      chapter: ch1._id,
      title: "History & Trivia Master Quiz",
      slug: "history-master-quiz",
      type: "quiz",
      estimatedMinutes: 6,
      xpReward: 40,
      sortOrder: 4,
      isPublished: true,
      blocks: [
        {
          blockType: "heading",
          content: "Test Your History Knowledge",
          config: { level: 1 },
        },
        {
          blockType: "question_mcq",
          content: "What does the Persian phrase 'Shāh māt' translate to?",
          config: {
            options: [
              { label: "The King is helpless / dead", isCorrect: true, explanation: "Correct! This is where the term 'Checkmate' comes from." },
              { label: "The Queen strikes", isCorrect: false, explanation: "Shāh refers specifically to the King." },
              { label: "Victory is near", isCorrect: false, explanation: "It means the King cannot escape." },
            ],
          },
        },
        {
          blockType: "question_mcq",
          content: "Which century saw the Queen become the most powerful piece on the board?",
          config: {
            options: [
              { label: "15th Century (1475-1500)", isCorrect: true, explanation: "Correct! European rule changes in the late 15th century created modern chess." },
              { label: "6th Century", isCorrect: false, explanation: "In Chaturanga, the vizier moved only 1 square diagonally." },
              { label: "20th Century", isCorrect: false, explanation: "Modern piece movements were standardized 500 years ago." },
            ],
          },
        },
      ],
    });

    ch1.lessons = [l1_1._id, l1_2._id, l1_3._id, l1_4._id];
    await ch1.save();

    // ── CHAPTER 2: Chess Board & Piece Movement ───────────────────────────────
    const ch2 = await Chapter.create({
      course: course._id,
      title: "Chapter 2: Chess Board & Piece Movements",
      description: "Master algebraic coordinates and interactive movements for all 6 chess pieces.",
      sortOrder: 2,
    });

    const l2_1 = await Lesson.create({
      course: course._id,
      chapter: ch2._id,
      title: "Chess Board & Setup",
      slug: "chess-board-and-setup",
      type: "interactive",
      estimatedMinutes: 10,
      xpReward: 30,
      sortOrder: 1,
      isPublished: true,
      blocks: [
        {
          blockType: "heading",
          content: "The 64 Squares of the Chess Board",
          config: { level: 1 },
        },
        {
          blockType: "paragraph",
          content: "The chess board consists of an 8x8 grid with 64 alternating light and dark squares. Golden Rule: 'White on the Right'—the bottom-right square closest to each player MUST always be a light square!",
        },
        {
          blockType: "board_autoplay",
          content: "Starting Position Setup",
          config: {
            board: {
              fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
              moveSequence: ["e2e4", "e7e5", "g1f3", "b8c6"],
              moveSpeed: 1200,
            },
          },
        },
      ],
    });

    const l2_2 = await Lesson.create({
      course: course._id,
      chapter: ch2._id,
      title: "Files, Ranks & Coordinates",
      slug: "files-ranks-and-coordinates",
      type: "interactive",
      estimatedMinutes: 10,
      xpReward: 35,
      sortOrder: 2,
      isPublished: true,
      blocks: [
        {
          blockType: "heading",
          content: "Understanding Chess Coordinates",
          config: { level: 1 },
        },
        {
          blockType: "paragraph",
          content: "Every square on the chess board has a unique 2-character coordinate name:",
        },
        {
          blockType: "summary",
          content: "• Files: Vertical columns labeled with letters 'a' through 'h'.\n• Ranks: Horizontal rows labeled with numbers '1' through '8'.\n• Square Name = File Letter + Rank Number (e.g. e4).",
        },
        {
          blockType: "question_board_click",
          content: "Interactive Exercise: Click on the e4 square on the board below.",
          config: {
            targetSquare: "e4",
            instruction: "Find and click the e4 square (File 'e', Rank '4').",
          },
        },
      ],
    });

    const l2_3 = await Lesson.create({
      course: course._id,
      chapter: ch2._id,
      title: "The Knight: L-Shaped Jumper",
      slug: "the-knight-movement",
      type: "interactive",
      estimatedMinutes: 12,
      xpReward: 40,
      sortOrder: 3,
      isPublished: true,
      blocks: [
        {
          blockType: "heading",
          content: "How the Knight Moves & Jumps",
          config: { level: 1 },
        },
        {
          blockType: "paragraph",
          content: "The Knight is the most unique piece in chess. It moves in an 'L' shape: 2 squares in one cardinal direction and then 1 square perpendicular. It is also the ONLY piece that can jump over other pieces!",
        },
        {
          blockType: "coach_tip",
          content: "Notice that every time a Knight moves, it changes square color! A Knight on a light square always lands on a dark square.",
          config: { title: "Knight Rule" },
        },
        {
          blockType: "board_autoplay",
          content: "Knight Moves & Jumps Demonstration",
          config: {
            board: {
              fen: "4k3/8/8/8/4N3/8/8/4K3 w - - 0 1",
              moveSequence: ["e4d6", "e8e7", "d6f5", "e7f6"],
              moveSpeed: 1400,
            },
          },
        },
        {
          blockType: "board_practice",
          content: "Practice Move: Move the Knight on e4 to one of its legal L-shaped squares.",
          config: {
            board: {
              fen: "8/8/8/8/4N3/8/8/8 w - - 0 1",
              practice: {
                expectedMoves: ["e4d6", "e4f6", "e4c5", "e4g5", "e4c3", "e4g3", "e4d2", "e4f2"],
              },
            },
          },
        },
      ],
    });

    const l2_4 = await Lesson.create({
      course: course._id,
      chapter: ch2._id,
      title: "The Rook: Straight Line Power",
      slug: "the-rook-movement",
      type: "interactive",
      estimatedMinutes: 10,
      xpReward: 35,
      sortOrder: 4,
      isPublished: true,
      blocks: [
        {
          blockType: "heading",
          content: "The Mighty Rook",
          config: { level: 1 },
        },
        {
          blockType: "paragraph",
          content: "The Rook moves any number of squares horizontally along ranks or vertically along files, as long as no piece blocks its path.",
        },
        {
          blockType: "board_practice",
          content: "Practice: Move the Rook from d4 along rank 4 or file d.",
          config: {
            board: {
              fen: "8/8/8/8/3R4/8/8/8 w - - 0 1",
              practice: {
                expectedMoves: ["d4d8", "d4d7", "d4d6", "d4d5", "d4d3", "d4d2", "d4d1", "d4a4", "d4b4", "d4c4", "d4e4", "d4f4", "d4g4", "d4h4"],
              },
            },
          },
        },
      ],
    });

    const l2_5 = await Lesson.create({
      course: course._id,
      chapter: ch2._id,
      title: "The Bishop: Diagonal Laser",
      slug: "the-bishop-movement",
      type: "interactive",
      estimatedMinutes: 10,
      xpReward: 35,
      sortOrder: 5,
      isPublished: true,
      blocks: [
        {
          blockType: "heading",
          content: "The Diagonally Bound Bishop",
          config: { level: 1 },
        },
        {
          blockType: "paragraph",
          content: "The Bishop moves any number of squares diagonally. Because it moves only along diagonals, a Bishop stays on squares of its starting color for the entire game!",
        },
        {
          blockType: "board_practice",
          content: "Practice: Move the Light-Squared Bishop from c4 along its diagonal.",
          config: {
            board: {
              fen: "8/8/8/8/2B5/8/8/8 w - - 0 1",
              practice: {
                expectedMoves: ["c4f7", "c4e6", "c4d5", "c4b3", "c4a2", "c4a6", "c4b5", "c4d3", "c4e2", "c4f1"],
              },
            },
          },
        },
      ],
    });

    const l2_6 = await Lesson.create({
      course: course._id,
      chapter: ch2._id,
      title: "The Queen: Ultimate Power",
      slug: "the-queen-movement",
      type: "interactive",
      estimatedMinutes: 12,
      xpReward: 40,
      sortOrder: 6,
      isPublished: true,
      blocks: [
        {
          blockType: "heading",
          content: "The Queen: Combining Rook & Bishop",
          config: { level: 1 },
        },
        {
          blockType: "paragraph",
          content: "The Queen is the most powerful piece on the board. She combines the abilities of both the Rook and Bishop—moving any number of squares horizontally, vertically, or diagonally!",
        },
        {
          blockType: "board_practice",
          content: "Practice: Move the Queen on d4 to any legal square.",
          config: {
            board: {
              fen: "8/8/8/8/3Q4/8/8/8 w - - 0 1",
              practice: {
                expectedMoves: ["d4d8", "d4a7", "d4h8", "d4g4", "d4a4", "d4d1", "d4g1", "d4a1"],
              },
            },
          },
        },
      ],
    });

    const l2_7 = await Lesson.create({
      course: course._id,
      chapter: ch2._id,
      title: "The King & Pawn Mechanics",
      slug: "king-and-pawn-mechanics",
      type: "interactive",
      estimatedMinutes: 12,
      xpReward: 40,
      sortOrder: 7,
      isPublished: true,
      blocks: [
        {
          blockType: "heading",
          content: "The King & Pawn Rules",
          config: { level: 1 },
        },
        {
          blockType: "paragraph",
          content: "The King is the most important piece—if he is checkmated, the game ends immediately! The King moves 1 square in any direction. Pawns move forward 1 square (or 2 squares on their first move), but capture 1 square diagonally forward.",
        },
        {
          blockType: "board_practice",
          content: "Practice: Advance the Pawn on e2 two squares forward to e4.",
          config: {
            board: {
              fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
              practice: {
                expectedMoves: ["e2e4"],
              },
            },
          },
        },
      ],
    });

    ch2.lessons = [l2_1._id, l2_2._id, l2_3._id, l2_4._id, l2_5._id, l2_6._id, l2_7._id];
    await ch2.save();

    // ── CHAPTER 3: Basic Tactics ──────────────────────────────────────────────
    const ch3 = await Chapter.create({
      course: course._id,
      title: "Chapter 3: Essential Chess Tactics",
      description: "Master Checks, Checkmates, Pins, Forks, and Skewers to win material and games.",
      sortOrder: 3,
    });

    const l3_1 = await Lesson.create({
      course: course._id,
      chapter: ch3._id,
      title: "Check, Checkmate & Stalemate",
      slug: "check-checkmate-and-stalemate",
      type: "interactive",
      estimatedMinutes: 12,
      xpReward: 45,
      sortOrder: 1,
      isPublished: true,
      blocks: [
        {
          blockType: "heading",
          content: "Understanding Checkmate",
          config: { level: 1 },
        },
        {
          blockType: "paragraph",
          content: "• Check: The enemy king is under direct attack.\n• Checkmate: The king is in check and has NO legal moves to escape (Game Over!).\n• Stalemate: The king is NOT in check, but has NO legal moves (Draw).",
        },
        {
          blockType: "board_autoplay",
          content: "Scholar's Mate Demonstration (1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6 4.Qxf7#)",
          config: {
            board: {
              fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
              moveSequence: ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"],
              moveSpeed: 1400,
            },
          },
        },
      ],
    });

    const l3_2 = await Lesson.create({
      course: course._id,
      chapter: ch3._id,
      title: "The Fork Tactical Motif",
      slug: "the-fork-tactic",
      type: "interactive",
      estimatedMinutes: 12,
      xpReward: 50,
      sortOrder: 2,
      isPublished: true,
      blocks: [
        {
          blockType: "heading",
          content: "The Royal Knight Fork",
          config: { level: 1 },
        },
        {
          blockType: "paragraph",
          content: "A Fork occurs when a single piece attacks two or more enemy pieces simultaneously. Knights are the ultimate forkers!",
        },
        {
          blockType: "board_practice",
          content: "Practice: Move your Knight to c7 to fork the Black King on e8 and Rook on a8!",
          config: {
            board: {
              fen: "r3k3/8/8/2N5/8/8/8/4K3 w - - 0 1",
              practice: {
                expectedMoves: ["c5c7"],
              },
            },
          },
        },
      ],
    });

    const l3_3 = await Lesson.create({
      course: course._id,
      chapter: ch3._id,
      title: "The Pin Tactical Motif",
      slug: "the-pin-tactic",
      type: "interactive",
      estimatedMinutes: 12,
      xpReward: 50,
      sortOrder: 3,
      isPublished: true,
      blocks: [
        {
          blockType: "heading",
          content: "Pinning Enemy Pieces to the King",
          config: { level: 1 },
        },
        {
          blockType: "paragraph",
          content: "A Pin occurs when an attacking piece targets a valuable piece (or King) behind an intervening piece. The pinned piece cannot move without exposing the higher-value piece behind it!",
        },
        {
          blockType: "board_practice",
          content: "Practice: Move your Bishop to b5 to pin the Black Knight on c6 against the King on e8!",
          config: {
            board: {
              fen: "r1bqk2r/pppp1ppp/2n5/4p3/8/5N2/PPPP1PPP/R1BQK2R w KQkq - 0 1",
              practice: {
                expectedMoves: ["f1b5"],
              },
            },
          },
        },
      ],
    });

    ch3.lessons = [l3_1._id, l3_2._id, l3_3._id];
    await ch3.save();

    // Link chapters to course
    course.chapters = [ch1._id, ch2._id, ch3._id];
    await course.save();

    console.log("Successfully seeded 3-Chapter Production Curriculum for 'Chess Fundamentals'!");
    process.exit(0);
  } catch (err) {
    console.error("Error seeding curriculum:", err);
    process.exit(1);
  }
}

seedProductionCurriculum();
