
import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { Server } from "socket.io";
import userRoutes from "./routes/user.route.js";
import adminRoutes from "./routes/admin.route.js";
import connectDB from "./config/db.js"
import puzzleRoutes from "./routes/puzzle.route.js";
import competitionRoutes from "./routes/competition.route.js";
import liveCompetitionRoutes from "./routes/liveCompetition.route.js";
import categoryRoutes from "./routes/category.route.js";
import quizCategoryRoutes from "./routes/quizCategory.route.js";
import quizRoutes from "./routes/quiz.route.js";
import examRoutes from "./routes/exam.route.js";
import { Chess } from "chess.js";
import { initializeSocketHandlers } from "./utils/socketHandlers.js";
import eventRoutes from "./routes/event.route.js";
import liveEventRoutes from "./routes/liveEvent.route.js";
import themeRoutes from "./routes/theme.route.js";
import quoteRoutes from "./routes/quote.route.js";
// ===============================
// LEARNING MODULE INTEGRATION
// Added for Chess Learning Module
// Do not mix learning-specific logic here.
// ===============================
import learningRoutes from "./modules/learning/index.js";
import { initializeEventSocketHandlers } from "./utils/socketEventHandlers.js";
import { initializeExamSocketHandlers } from "./utils/socketExamHandlers.js";

import { initCronJobs } from "./utils/cronJobs.js";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Config

connectDB();

// Start scheduled jobs (after DB is configured)
initCronJobs();

const app = express();
const server = createServer(app);

// Required for correct client IP detection behind Nginx (rate limiting, logs, etc.)
// If you have multiple proxy hops, set this to the exact hop count instead of "1".
app.set("trust proxy", 1);

// Middleware - Allowed Origins for CORS
const allowedOrigins = new Set(
  [
    process.env.FRONTEND_URL,
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "https://test.quickchessforyou.com",
    "https://qcfy-test.netlify.app"
  ].filter(Boolean)
);

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: Array.from(allowedOrigins),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  },
});

// Initialize socket handlers
initializeSocketHandlers(io);
initializeEventSocketHandlers(io);
initializeExamSocketHandlers(io);

console.log("FRONTEND_URL =", process.env.FRONTEND_URL);
console.log("Allowed Origins =", Array.from(allowedOrigins));

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser clients (curl/postman) where Origin is not set
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true, // Required for httpOnly cookies to be sent cross-origin
    optionsSuccessStatus: 204,
  })
);
app.use(cookieParser()); // Parse cookies from incoming requests
// Keep the global limit tight — protects all routes (exam, auth, quiz, etc.)
// from oversized payloads. The bulk puzzle import route overrides this limit
// inline (see puzzle.route.js) so it can still accept large batches.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));

// Serve static files from uploads directory
app.use("/uploads", express.static(path.join(__dirname, "uploads")));


// Routes
app.use("/api/user", userRoutes)
app.use("/api/admin", adminRoutes)
app.use("/api/puzzle", puzzleRoutes)
app.use("/api/competition", competitionRoutes)
app.use("/api/live-competition", liveCompetitionRoutes)
app.use("/api/category", categoryRoutes)
app.use("/api/quiz-category", quizCategoryRoutes)
app.use("/api/quiz", quizRoutes)
app.use("/api/exam", examRoutes)
app.use("/api/event", eventRoutes)
app.use("/api/live-event", liveEventRoutes)
app.use("/api/theme", themeRoutes)
app.use("/api/quote", quoteRoutes)
app.use("/api/learning", learningRoutes)

app.use("/api/event", liveCompetitionRoutes) // Event routes use same controller as live competitions

app.get("/", (req, res) => {
  return res.status(200).json({ message: "QuickChess4U backend is running" });
})

app.get("/api/ping", (req, res) => {
  return res.status(200).json({ success: true });
})


console.log("Chess import:", Chess);


// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Socket.IO server initialized`);
});
server.timeout = 10 * 60 * 1000; // 10 minutes for large bulk imports

// Export io for use in other modules
export { io };