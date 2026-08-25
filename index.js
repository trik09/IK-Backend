import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import helmet from "helmet";
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
import clientErrorReportRoutes from "./routes/clientErrorReport.route.js";
import platformSettingsRoutes from "./routes/platformSettings.route.js";
// ===============================
// LEARNING MODULE INTEGRATION
// Added for Chess Learning Module
// Do not mix learning-specific logic here.
// ===============================
import learningRoutes from "./modules/learning/index.js";
import { initializeEventSocketHandlers } from "./utils/socketEventHandlers.js";
import { initializeExamSocketHandlers } from "./utils/socketExamHandlers.js";

import { initCronJobs } from "./utils/cronJobs.js";
import mongoose from "mongoose";
import redis from "./config/redis.js";
import { getMetrics } from "./utils/cacheMetrics.js";
import { getLiveInFlight } from "./middleware/liveLoadGuard.middleware.js";

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

// Middleware - Allowed Origins for CORS including production & staging domains
const allowedOrigins = new Set(
  [
    process.env.FRONTEND_URL,
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "https://quickchess.org",
    "https://www.quickchess.org",
    "https://quickchessforyou.com",
    "https://www.quickchessforyou.com",
    "https://test.quickchessforyou.com",
    "https://qcfy-test.netlify.app",
    "https://api.triklabs.com"
  ].filter(Boolean)
);

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  if (
    origin.endsWith(".quickchess.org") ||
    origin.endsWith(".quickchessforyou.com") ||
    origin.endsWith(".triklabs.com") ||
    origin.endsWith(".netlify.app")
  ) {
    return true;
  }
  return false;
};

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) return callback(null, true);
      return callback(null, false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  },
  pingInterval: 25000,
  pingTimeout: 60000,
  connectTimeout: 20000,
  maxHttpBufferSize: 1e6,
  perMessageDeflate: false,
  transports: ["websocket", "polling"],
});

initializeSocketHandlers(io);
initializeEventSocketHandlers(io);
initializeExamSocketHandlers(io);

console.log("FRONTEND_URL =", process.env.FRONTEND_URL);
console.log("Allowed Origins =", Array.from(allowedOrigins));

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser clients (curl/postman/load-test) where Origin is not set
      if (isAllowedOrigin(origin)) return callback(null, true);
      // Reject without throwing — cors Error callbacks become HTTP 500.
      return callback(null, false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true, // Required for httpOnly cookies to be sent cross-origin
    optionsSuccessStatus: 204,
  })
);
app.use(cookieParser()); // Parse cookies from incoming requests
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));

// Compress JSON responses
try {
  const { default: compression } = await import("compression");
  app.use(
    compression({
      threshold: 1024,
      filter: (req, res) => {
        const url = req.originalUrl || req.url || "";
        if (
          url.startsWith("/api/live-competition") ||
          url.startsWith("/api/live-event") ||
          url.startsWith("/socket.io")
        ) {
          return false;
        }
        return compression.filter(req, res);
      },
    })
  );
} catch {
  console.warn("[Startup] compression package not installed — skipping gzip middleware");
}

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
app.use("/api/events", eventRoutes)
app.use("/api/live-event", liveEventRoutes)
app.use("/api/themes", themeRoutes)
app.use("/api/quotes", quoteRoutes)
app.use("/api/client-errors", clientErrorReportRoutes)
app.use("/api/platform-settings", platformSettingsRoutes)

// ===============================
// LEARNING MODULE ROUTE REGISTRATION
// Mounts all learning subsystem routes under /api/learning
// ===============================
app.use("/api/learning", learningRoutes);

// Health check endpoint
app.get("/health", async (req, res) => {
  let dbStatus = "disconnected";
  let redisStatus = "disabled";
  try {
    if (mongoose.connection.readyState === 1) {
      dbStatus = "connected";
    }
  } catch (err) {
    dbStatus = "error";
  }

  try {
    if (redis && redis.status === "ready") {
      redisStatus = "ready";
    }
  } catch (err) {
    redisStatus = "error";
  }

  const inFlight = getLiveInFlight();
  const metrics = getMetrics();

  res.status(200).json({
    status: "ok",
    timestamp: new Date(),
    uptime: process.uptime(),
    database: dbStatus,
    redis: redisStatus,
    inFlightRequests: inFlight,
    cacheMetrics: metrics,
    memoryUsage: process.memoryUsage(),
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});