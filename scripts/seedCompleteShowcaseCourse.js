import mongoose from "mongoose";
import dotenv from "dotenv";
import CourseModel from "../models/CourseSchema.js";
import ChapterModel from "../models/ChapterSchema.js";
import LessonModel from "../models/LessonSchema.js";

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/quickchess";

async function seedCompleteShowcaseCourse() {
  try {
    console.log("Connecting to MongoDB:", MONGO_URI);
    await mongoose.connect(MONGO_URI);
    console.log("MongoDB connected successfully.");

    // Remove existing showcase course if present
    const existingCourse = await CourseModel.findOne({ slug: "complete-chess-mastery-showcase" });
    if (existingCourse) {
      console.log("Removing existing showcase course...");
      await LessonModel.deleteMany({ course: existingCourse._id });
      await ChapterModel.deleteMany({ course: existingCourse._id });
      await CourseModel.deleteOne({ _id: existingCourse._id });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 1. Create Showcase Course
    // ═════════════════════════════════════════════════════════════════════════
    const course = new CourseModel({
      title: "Complete Chess Masterclass: All Interactive Varieties",
      slug: "complete-chess-mastery-showcase",
      subtitle: "A comprehensive course covering every lesson format, board mechanic, and assessment variety.",
      description:
        "Explore all 7 interactive lesson varieties: theory blocks, coach tips, warning alerts, rich media, static board diagrams, animated autoplay sequences, playable interactive drills, multiple choice quizzes, board-click target questions, and fill-in-the-blank challenges.",
      thumbnail: "https://images.unsplash.com/photo-1529699211952-734e80c4d42b?q=80&w=1000&auto=format&fit=crop",
      difficulty: "beginner",
      estimatedHours: 3,
      accessLevel: "free",
      isPublished: true,
      isFeatured: true,
      publishedAt: new Date(),
      instructor: "GM Alex Vance & Coach QCFY",
      outcomes: [
        "Understand every lesson format: Text, Visuals, Boards, and Quizzes",
        "Experience animated auto-play move replays with tactical arrows",
        "Practice real-time move validation on interactive chessboards",
        "Test knowledge using Board-Click, MCQ, and Fill-in-the-Blank assessments",
      ],
      chapters: [],
    });
    await course.save();

    // ═════════════════════════════════════════════════════════════════════════
    // CHAPTER 1: Theory & Visual Explanations
    // ═════════════════════════════════════════════════════════════════════════
    const ch1 = new ChapterModel({
      course: course._id,
      title: "Chapter 1: Theory, Guidance & Visual Modules",
      description: "Learn foundational concepts using headings, coach tips, warnings, summaries, and infographics.",
      sortOrder: 1,
      lessons: [],
    });
    await ch1.save();

    // --- Lesson 1.1: Theory & Coaching Blocks ---
    const l1 = new LessonModel({
      course: course._id,
      chapter: ch1._id,
      title: "1.1 The Golden Rules of Chess: Theory & Strategy Tips",
      slug: "golden-rules-theory-coach-tips",
      description: "Sample lesson demonstrating Headings, Paragraphs, Coach Tips, Warning Boxes, Dividers, and Summary Cards.",
      type: "theory",
      estimatedMinutes: 5,
      xpReward: 20,
      isPublished: true,
      sortOrder: 1,
      blocks: [
        {
          blockType: "heading",
          type: "heading",
          text: { level: 1, content: "The Three Golden Rules of Opening Strategy" },
        },
        {
          blockType: "paragraph",
          type: "paragraph",
          text: {
            content:
              "In chess, the opening phase sets the tone for the entire battle. Every master player follows three core principles from their first move: controlling the center, developing knights and bishops swiftly, and safeguarding the king via castling.",
          },
        },
        {
          blockType: "coach_tip",
          type: "coach_tip",
          text: {
            content:
              "Always develop your knights before your bishops! Knights operate best when placed on c3 and f3 early where they exert maximum control over central squares.",
          },
          metadata: { coachName: "GM Alex Vance" },
        },
        {
          blockType: "divider",
          type: "divider",
        },
        {
          blockType: "heading",
          type: "heading",
          text: { level: 2, content: "Crucial Opening Hazards" },
        },
        {
          blockType: "warning_box",
          type: "warning_box",
          text: {
            content:
              "Beware of bringing your Queen out too early in the opening! When the Queen moves prematurely, the opponent can develop their minor pieces with tempo by attacking her, leaving you behind in piece development.",
          },
        },
        {
          blockType: "summary",
          type: "summary",
          text: {
            content:
              "Opening Checklist: 1) Stake claim to e4/d4, 2) Mobilize minor pieces, 3) Castle early, and 4) Never move the same piece twice without a concrete tactical reason.",
          },
        },
      ],
    });
    await l1.save();

    // --- Lesson 1.2: Media & Static Board Visualization ---
    const l2 = new LessonModel({
      course: course._id,
      chapter: ch1._id,
      title: "1.2 Visualizing Piece Power: Media & Static Board Highlights",
      slug: "visualizing-piece-power-media-static-board",
      description: "Sample lesson demonstrating Image media blocks and Static Board overlays with multi-colored arrows and highlighted squares.",
      type: "theory",
      estimatedMinutes: 6,
      xpReward: 25,
      isPublished: true,
      sortOrder: 2,
      blocks: [
        {
          blockType: "heading",
          type: "heading",
          text: { level: 1, content: "The Power of Piece Placement" },
        },
        {
          blockType: "image",
          type: "image",
          media: {
            url: "https://images.unsplash.com/photo-1586165368502-1bad197a6461?w=800&q=80",
            caption: "Tactical vision and spatial control determine victory on the board.",
            alt: "Chess Tactical Vision",
            width: "100%",
          },
        },
        {
          blockType: "paragraph",
          type: "paragraph",
          text: {
            content:
              "Notice the static chessboard diagram below. White's knight on d5 is an unshakeable monster outpost supported by the c4 pawn, directly eyeing the weak c7 fork square.",
          },
        },
        {
          blockType: "board_static",
          type: "board_static",
          board: {
            fen: "r1bqkb1r/pp1p1ppp/2n1pn2/2p5/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 5",
            orientation: "white",
            caption: "White controls central diagonals with the Bishop on c4 and prepares 0-0.",
            arrows: [
              { from: "c4", to: "f7", color: "#e63946" },
              { from: "f3", to: "g5", color: "#e8a94e" },
              { from: "e1", to: "g1", color: "#43732F" },
            ],
            highlightSquares: [
              { square: "f7", color: "rgba(239, 68, 68, 0.4)" },
              { square: "e4", color: "rgba(34, 197, 94, 0.3)" },
            ],
          },
        },
        {
          blockType: "coach_tip",
          type: "coach_tip",
          text: {
            content:
              "Notice the red arrow from c4 pointing at f7. In the initial position, f7 is Black's weakest square because it is defended only by the King.",
          },
          metadata: { coachName: "Coach QCFY" },
        },
      ],
    });
    await l2.save();

    ch1.lessons = [l1._id, l2._id];
    await ch1.save();

    // ═════════════════════════════════════════════════════════════════════════
    // CHAPTER 2: Dynamic Board Mechanics (Autoplay & Interactive Drills)
    // ═════════════════════════════════════════════════════════════════════════
    const ch2 = new ChapterModel({
      course: course._id,
      title: "Chapter 2: Dynamic Board Drills & Automated Replays",
      description: "Watch automated move animations and practice tactical drills with interactive piece movement.",
      sortOrder: 2,
      lessons: [],
    });
    await ch2.save();

    // --- Lesson 2.1: Autoplay Animated Move Sequence ---
    const l3 = new LessonModel({
      course: course._id,
      chapter: ch2._id,
      title: "2.1 Animated Masterclass: The Scholar's Mate Attack",
      slug: "animated-scholars-mate-replay",
      description: "Sample lesson demonstrating the Autoplay Board block with step-by-step automated piece movement and tactical arrows.",
      type: "game_replay",
      estimatedMinutes: 6,
      xpReward: 30,
      isPublished: true,
      sortOrder: 1,
      blocks: [
        {
          blockType: "heading",
          type: "heading",
          text: { level: 1, content: "The Scholar's Mate Replay" },
        },
        {
          blockType: "paragraph",
          type: "paragraph",
          text: {
            content:
              "The Scholar's Mate is a classic 4-move checkmate targeting the vulnerable f7 square. Watch the automated replay below as White coordinates the Queen and Bishop to deliver a swift checkmate.",
          },
        },
        {
          blockType: "board_autoplay",
          type: "board_autoplay",
          board: {
            fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            orientation: "white",
            moves: [
              { from: "e2", to: "e4" },
              { from: "e7", to: "e5" },
              { from: "f1", to: "c4" },
              { from: "b8", to: "c6" },
              { from: "d1", to: "h5" },
              { from: "g8", to: "f6" },
              { from: "h5", to: "f7" },
            ],
            autoplaySpeed: 1100,
            arrows: [
              { from: "c4", to: "f7", color: "#e8a94e" },
              { from: "h5", to: "f7", color: "#e63946" },
            ],
            highlightSquares: [{ square: "f7", color: "rgba(239, 68, 68, 0.45)" }],
            caption: "Automated sequence: 1.e4 e5 2.Bc4 Nc6 3.Qh5 Nf6 4.Qxf7#",
          },
        },
        {
          blockType: "coach_tip",
          type: "coach_tip",
          text: {
            content:
              "To defend against 3.Qh5, Black should play 3...g6! attacking the queen while creating a safe shield.",
          },
          metadata: { coachName: "GM Alex Vance" },
        },
      ],
    });
    await l3.save();

    // --- Lesson 2.2: Interactive Move Practice Drill ---
    const l4 = new LessonModel({
      course: course._id,
      chapter: ch2._id,
      title: "2.2 Hands-On Drill: Forking King & Rook with the Knight",
      slug: "hands-on-drill-knight-fork",
      description: "Sample lesson demonstrating the Interactive Practice Board where students drag pieces to solve tactical puzzles.",
      type: "practice",
      estimatedMinutes: 5,
      xpReward: 35,
      isPublished: true,
      sortOrder: 2,
      blocks: [
        {
          blockType: "heading",
          type: "heading",
          text: { level: 1, content: "Execute the Royal Fork" },
        },
        {
          blockType: "paragraph",
          type: "paragraph",
          text: {
            content:
              "A fork occurs when a single piece attacks two enemy pieces simultaneously. In the position below, find White's winning knight leap that forks Black's King and Rook!",
          },
        },
        {
          blockType: "board_practice",
          type: "board_practice",
          board: {
            fen: "r3k2r/pppb1ppp/2n1pn2/3q4/3P4/2N1PN2/PP3PPP/R1BQKB1R w KQkq - 1 8",
            orientation: "white",
            practice: {
              expectedMoves: ["c3d5"],
            },
            expectedMoves: [{ from: "c3", to: "d5" }],
            hints: ["Look at Black's Queen on d5. White's knight on c3 can capture it!"],
            successMessage: "🌟 Excellent! You captured Black's queen on d5 and gained a decisive material advantage!",
          },
          points: 15,
        },
        {
          blockType: "summary",
          type: "summary",
          text: {
            content:
              "Knight forks are especially dangerous because knights cannot be blocked and attack diagonally and orthogonally unlike other pieces.",
          },
        },
      ],
    });
    await l4.save();

    ch2.lessons = [l3._id, l4._id];
    await ch2.save();

    // ═════════════════════════════════════════════════════════════════════════
    // CHAPTER 3: Interactive Assessments & Knowledge Checks
    // ═════════════════════════════════════════════════════════════════════════
    const ch3 = new ChapterModel({
      course: course._id,
      title: "Chapter 3: Interactive Quizzes & Assessments",
      description: "Test student mastery with Multiple Choice, Board Click targeting, and Fill-in-the-Blank quizzes.",
      sortOrder: 3,
      lessons: [],
    });
    await ch3.save();

    // --- Lesson 3.1: Multiple Choice Question (MCQ) ---
    const l5 = new LessonModel({
      course: course._id,
      chapter: ch3._id,
      title: "3.1 Assessment Variety: Multiple Choice Quiz (MCQ)",
      slug: "quiz-variety-multiple-choice",
      description: "Sample lesson demonstrating Multiple Choice Questions with instant answer validation and explanations.",
      type: "quiz",
      estimatedMinutes: 4,
      xpReward: 20,
      isPublished: true,
      sortOrder: 1,
      blocks: [
        {
          blockType: "heading",
          type: "heading",
          text: { level: 1, content: "Strategic Decision Quiz" },
        },
        {
          blockType: "paragraph",
          type: "paragraph",
          text: {
            content: "Select the best strategic choice from the options below to test your opening comprehension.",
          },
        },
        {
          blockType: "question_mcq",
          type: "question_mcq",
          question: {
            questionText: "Why is castling such a high-priority move during the opening phase?",
            options: [
              {
                id: "opt1",
                text: "It moves the King to safety behind a wall of pawns and activates the Rook towards the center.",
                isCorrect: true,
                explanation: "Correct! Castling accomplishes two crucial goals in one single turn: King safety and Rook activation.",
              },
              {
                id: "opt2",
                text: "It gives you two extra queens on the board.",
                isCorrect: false,
                explanation: "Castling does not promote or create new pieces.",
              },
              {
                id: "opt3",
                text: "It prevents your opponent from moving their pawns.",
                isCorrect: false,
                explanation: "Castling does not freeze enemy pawns.",
              },
            ],
          },
          points: 10,
        },
        {
          blockType: "coach_tip",
          type: "coach_tip",
          text: {
            content: "Try to castle within the first 7 to 10 moves of every standard chess game!",
          },
          metadata: { coachName: "GM Alex Vance" },
        },
      ],
    });
    await l5.save();

    // --- Lesson 3.2: Board Click Target Question ---
    const l6 = new LessonModel({
      course: course._id,
      chapter: ch3._id,
      title: "3.2 Assessment Variety: Interactive Board Click Question",
      slug: "quiz-variety-board-click",
      description: "Sample lesson demonstrating the Board Click assessment where users click directly on the target chess square.",
      type: "quiz",
      estimatedMinutes: 4,
      xpReward: 25,
      isPublished: true,
      sortOrder: 2,
      blocks: [
        {
          blockType: "heading",
          type: "heading",
          text: { level: 1, content: "Find the Critical Central Square" },
        },
        {
          blockType: "paragraph",
          type: "paragraph",
          text: {
            content:
              "Examine the chessboard below. Click directly on the central square that White's King pawn advances to on move 1 (1.e4)!",
          },
        },
        {
          blockType: "question_board_click",
          type: "question_board_click",
          question: {
            questionText: "Click on the e4 square on the chessboard below:",
            targetSquares: ["e4"],
            successMessage: "🎯 Perfect bullseye! e4 is the primary central square in 1.e4 openings.",
          },
          board: {
            fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            orientation: "white",
            highlightSquares: [{ square: "e4", color: "rgba(59, 130, 246, 0.3)" }],
          },
          points: 10,
        },
        {
          blockType: "summary",
          type: "summary",
          text: {
            content: "Board Click assessments are ideal for teaching coordinates, identifying pins, and finding weak squares.",
          },
        },
      ],
    });
    await l6.save();

    // --- Lesson 3.3: Fill in the Blank Question ---
    const l7 = new LessonModel({
      course: course._id,
      chapter: ch3._id,
      title: "3.3 Assessment Variety: Fill in the Blank Text Challenge",
      slug: "quiz-variety-fill-in-the-blank",
      description: "Sample lesson demonstrating Fill-in-the-Blank interactive text questions with synonym & abbreviation validation.",
      type: "quiz",
      estimatedMinutes: 4,
      xpReward: 20,
      isPublished: true,
      sortOrder: 3,
      blocks: [
        {
          blockType: "heading",
          type: "heading",
          text: { level: 1, content: "Chess Vocabulary Challenge" },
        },
        {
          blockType: "paragraph",
          type: "paragraph",
          text: {
            content: "Test your chess terminology knowledge by typing your answer into the input box below.",
          },
        },
        {
          blockType: "question_fill_blank",
          type: "question_fill_blank",
          question: {
            questionText: "Which chess piece moves in an unique L-shape and can jump over other pieces?",
            correctAnswers: ["Knight", "knight", "KNIGHT", "N", "Horse", "horse"],
            placeholder: "Type piece name here...",
          },
          points: 10,
        },
        {
          blockType: "coach_tip",
          type: "coach_tip",
          text: {
            content: "In standard algebraic notation, the Knight is represented by the uppercase letter 'N' to distinguish it from the King ('K').",
          },
          metadata: { coachName: "Coach QCFY" },
        },
      ],
    });
    await l7.save();

    ch3.lessons = [l5._id, l6._id, l7._id];
    await ch3.save();

    // Link all chapters to the course
    course.chapters = [ch1._id, ch2._id, ch3._id];
    course.totalLessons = 7;
    await course.save();

    console.log("\n=======================================================");
    console.log("✅ Showcase Course Created Successfully!");
    console.log("Course ID:    ", course._id);
    console.log("Course Slug:  ", course.slug);
    console.log("Course Title: ", course.title);
    console.log("Total Chapters:", course.chapters.length);
    console.log("Total Lessons: ", course.totalLessons);
    console.log("=======================================================\n");
    console.log("Lesson Varieties Created:");
    console.log("  1. Theory & Coach Tips (Heading, Paragraph, Coach Tip, Warning, Summary, Divider)");
    console.log("  2. Media & Static Board (Image Block, Static Board with Arrows & Square Highlights)");
    console.log("  3. Autoplay Animated Board (Step-by-step move replay & speed controls)");
    console.log("  4. Interactive Practice Board (Draggable pieces, validation & hint system)");
    console.log("  5. Multiple Choice Quiz (MCQ with answer explanations & points)");
    console.log("  6. Board Click Targeting Quiz (Direct board square click detection)");
    console.log("  7. Fill-in-the-Blank Challenge (Terminology & text answer matching)");
    console.log("=======================================================\n");

    process.exit(0);
  } catch (err) {
    console.error("❌ Seeding Error:", err);
    process.exit(1);
  }
}

seedCompleteShowcaseCourse();
