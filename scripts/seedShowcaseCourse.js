import mongoose from "mongoose";
import dotenv from "dotenv";
import CourseModel from "../models/CourseSchema.js";
import ChapterModel from "../models/ChapterSchema.js";
import LessonModel from "../models/LessonSchema.js";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/qcfy";

async function seedShowcaseCourse() {
  try {
    console.log("Connecting to MongoDB:", MONGO_URI);
    await mongoose.connect(MONGO_URI);
    console.log("MongoDB connected successfully.");

    // Remove existing showcase course if present
    const existingCourse = await CourseModel.findOne({ slug: "gm-tactical-mastery" });
    if (existingCourse) {
      console.log("Removing existing showcase course...");
      await LessonModel.deleteMany({ course: existingCourse._id });
      await ChapterModel.deleteMany({ course: existingCourse._id });
      await CourseModel.deleteOne({ _id: existingCourse._id });
    }

    // 1. Create Course
    const course = new CourseModel({
      title: "Grandmaster Tactical Mastery & Opening Essentials",
      slug: "gm-tactical-mastery",
      subtitle: "Interactive step-by-step masterclass with live drills, opponent responses, and board tactics.",
      description:
        "Master the fundamentals of central dominance, dynamic piece play, and tactical visualization with real-time interactive chessboards, auto-opponents, and voice feedback.",
      thumbnail: "https://images.unsplash.com/photo-1529699211952-734e80c4d42b?q=80&w=1000&auto=format&fit=crop",
      difficulty: "intermediate",
      estimatedHours: 4,
      accessLevel: "free",
      isPublished: true,
      isFeatured: true,
      publishedAt: new Date(),
      instructor: "GM Alex Vance",
      outcomes: [
        "Master classical 1.e4 opening structures and central pawn fights",
        "Identify critical knight outposts and structural weaknesses",
        "Execute the Greek Gift (Bxh7+) sacrifice with precision",
        "Calculate multi-step tactical combinations with interactive feedback",
      ],
      chapters: [],
    });
    await course.save();

    // 2. Create Chapter 1
    const ch1 = new ChapterModel({
      course: course._id,
      title: "Chapter 1: Opening Principles & Central Domination",
      description: "Learn how to control key squares and develop pieces actively.",
      sortOrder: 1,
      lessons: [],
    });
    await ch1.save();

    // Lesson 1.1: Multi-Step Interactive Play (Player move + Opponent auto-reply + Voice feedback)
    const l1 = new LessonModel({
      course: course._id,
      chapter: ch1._id,
      title: "1.1 The Spanish Game (Ruy Lopez) - Interactive Drill",
      slug: "spanish-game-interactive-drill",
      description: "Play White's opening moves while Black responds dynamically. Master the first 3 moves of the Ruy Lopez.",
      estimatedMinutes: 5,
      xpReward: 30,
      isPublished: true,
      sortOrder: 1,
      blocks: [
        {
          blockType: "heading",
          text: { level: 1, content: "The Spanish Opening (1.e4 e5 2.Nf3 Nc6 3.Bb5)" },
        },
        {
          blockType: "paragraph",
          text: {
            content:
              "The Ruy Lopez is one of the oldest and most respected chess openings. White strikes at the center with 1.e4 and prepares active piece development. Drag your pieces on the board to complete the opening moves!",
          },
        },
        {
          blockType: "coach_tip",
          text: {
            content:
              "Push your e-pawn to e4, then develop your knight to f3 to attack Black's e5 pawn. Finally, pin the defending knight with Bb5!",
          },
          metadata: { coachName: "GM Alex Vance" },
        },
        {
          blockType: "board_practice",
          board: {
            fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            orientation: "white",
            practice: {
              expectedMoves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"],
              hints: [
                "Push your King's pawn two squares forward to e4.",
                "Develop your King's knight to f3 to attack Black's e5 pawn.",
                "Pin Black's knight on c6 with your bishop on b5 (Ruy Lopez)!",
              ],
              successMessage: "🎉 Awesome! You have successfully played the Spanish Opening with grandmaster precision!",
              failureMessage: "❌ That's not the best developing move. Try again!",
              validateMode: "strict",
            },
          },
          points: 15,
        },
        {
          blockType: "question_mcq",
          question: {
            questionText: "What is White's strategic intention behind playing 3.Bb5?",
            options: [
              {
                id: "opt1",
                text: "Pressure the c6 knight which protects Black's central e5 pawn.",
                isCorrect: true,
                explanation: "Correct! By attacking the defender on c6, White exerts indirect pressure on the center.",
              },
              {
                id: "opt2",
                text: "Give away the bishop for free.",
                isCorrect: false,
                explanation: "The bishop is not sacrificed; it actively pins the knight.",
              },
              {
                id: "opt3",
                text: "Block White's own pawns from advancing.",
                isCorrect: false,
                explanation: "Bb5 actively develops the bishop outside the pawn chain.",
              },
            ],
          },
          points: 10,
        },
      ],
    });
    await l1.save();

    // Lesson 1.2: Square Selection Question Block
    const l2 = new LessonModel({
      course: course._id,
      chapter: ch1._id,
      title: "1.2 Target Square Mastery: Identifying Strong Outposts",
      slug: "target-square-mastery-outposts",
      description: "Identify and click the critical outpost square in the pawn structure.",
      estimatedMinutes: 4,
      xpReward: 20,
      isPublished: true,
      sortOrder: 2,
      blocks: [
        {
          blockType: "heading",
          text: { level: 2, content: "Finding the Knight Outpost" },
        },
        {
          blockType: "paragraph",
          text: {
            content:
              "An outpost is a square on the 4th, 5th, or 6th rank that cannot be attacked by an enemy pawn. Examine Black's pawn structure and find the key central square.",
          },
        },
        {
          blockType: "question_board_click",
          question: {
            questionText: "Click on the ideal d5 central outpost square for White's knight!",
            targetSquares: ["d5"],
            successMessage: "🎉 Perfect! d5 is an unassailable square protected by White's pawns.",
          },
          board: {
            fen: "r1bq1rk1/pp1nbppp/2p1pn2/3p4/2PPP3/2N2NP1/PP3PBP/R1BQ1RK1 w - - 0 9",
            orientation: "white",
            arrows: [{ from: "c3", to: "d5", color: "#43732F" }],
            highlightSquares: [{ square: "d5", color: "rgba(255, 255, 0, 0.4)" }],
          },
          points: 10,
        },
        {
          blockType: "summary",
          text: {
            content: "Outposts allow knights to dominate the center, restrict enemy piece movement, and launch king attacks.",
          },
        },
      ],
    });
    await l2.save();

    ch1.lessons = [l1._id, l2._id];
    await ch1.save();

    // 3. Create Chapter 2
    const ch2 = new ChapterModel({
      course: course._id,
      title: "Chapter 2: Master Tactical Replays & Sacrifices",
      description: "Study famous Grandmaster attacking games and tactical patterns.",
      sortOrder: 2,
      lessons: [],
    });
    await ch2.save();

    // Lesson 2.1: Autoplay Board Animation with Move Commentary & Arrows
    const l3 = new LessonModel({
      course: course._id,
      chapter: ch2._id,
      title: "2.1 The Classic Greek Gift (Bxh7+) Masterclass",
      slug: "greek-gift-sacrifice-masterclass",
      description: "Watch the step-by-step animated destruction of Black's kingside defenses.",
      estimatedMinutes: 6,
      xpReward: 25,
      isPublished: true,
      sortOrder: 1,
      blocks: [
        {
          blockType: "heading",
          text: { level: 2, content: "The Greek Gift Sacrifice (1.Bxh7+!)" },
        },
        {
          blockType: "paragraph",
          text: {
            content:
              "When Black's king has castled and the f6 knight is absent, White can often blow open the h-file with a classic bishop sacrifice on h7. Press Play below to watch the animated sequence!",
          },
        },
        {
          blockType: "board_autoplay",
          board: {
            fen: "r1bq1rk1/ppp2ppp/2n1pn2/3p4/2PP4/2NBPN2/PP3PPP/R1BQK2R w KQ - 0 8",
            orientation: "white",
            moveSequence: ["d3h7", "g8h7", "f3g5", "h7g8", "d1h5", "f8e8", "h5f7", "g8h8", "f7h7"],
            moveSpeed: 1000,
            autoStart: true,
            arrows: [
              { from: "d3", to: "h7", color: "#e63946" },
              { from: "f3", to: "g5", color: "#e8a94e" },
              { from: "d1", to: "h5", color: "#43732F" },
            ],
            highlightSquares: [{ square: "h7", color: "rgba(239, 68, 68, 0.4)" }],
            caption: "Classic Bxh7+ Greek Gift Attack Sequence",
          },
        },
        {
          blockType: "coach_tip",
          text: {
            content: "Three essential criteria for the Greek Gift: 1) Active light-squared bishop, 2) Knight able to jump to g5, 3) Queen able to enter the h-file (h5 or g4).",
          },
          metadata: { coachName: "GM Alex Vance" },
        },
      ],
    });
    await l3.save();

    ch2.lessons = [l3._id];
    await ch2.save();

    course.chapters = [ch1._id, ch2._id];
    course.totalLessons = 3;
    await course.save();

    console.log("✅ Showcase Course seeded successfully!");
    console.log("Course ID:", course._id);
    console.log("Course Slug:", course.slug);
    console.log("Course Title:", course.title);
    process.exit(0);
  } catch (error) {
    console.error("Seeding error:", error);
    process.exit(1);
  }
}

seedShowcaseCourse();
