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
import connectDB from "./config/db.js";
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
import { initializePlaySocketHandlers } from "./utils/socketPlayHandlers.js";

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

// Normalize configured Frontend URL
const rawFrontendUrl = (process.env.FRONTEND_URL || "").trim().replace(/\/+$/, "");

// Middleware - Allowed Origins for CORS
const allowedOrigins = new Set(
  [
    rawFrontendUrl,
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
  const cleanOrigin = origin.trim().replace(/\/+$/, "");
  if (allowedOrigins.has(cleanOrigin)) return true;
  try {
    const cleanHost = cleanOrigin.replace(/^https?:\/\//, "").replace(/:[0-9]+$/, "");
    if (
      cleanHost === "quickchess.org" ||
      cleanHost.endsWith(".quickchess.org") ||
      cleanHost === "quickchessforyou.com" ||
      cleanHost.endsWith(".quickchessforyou.com") ||
      cleanHost === "triklabs.com" ||
      cleanHost.endsWith(".triklabs.com") ||
      cleanHost.endsWith(".netlify.app") ||
      cleanHost.endsWith(".vercel.app")
    ) {
      return true;
    }
  } catch (e) {}
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
initializePlaySocketHandlers(io);

console.log("FRONTEND_URL =", process.env.FRONTEND_URL);
console.log("Allowed Origins =", Array.from(allowedOrigins));

// Universal CORS Middleware — Guarantees Access-Control-Allow-Origin is ALWAYS set for quickchess.org & all origins
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, X-Socket-ID"
  );

  // Instantly resolve Preflight OPTIONS requests with 200 OK
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});

const corsMiddleware = cors({
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin", "Cache-Control"],
  optionsSuccessStatus: 200,
});

app.use(corsMiddleware);
app.options("*", corsMiddleware);

app.use(cookieParser()); // Parse cookies from incoming requests
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
  })
);
// Keep the global limit tight — protects all routes (exam, auth, quiz, etc.)
// from oversized payloads. The bulk puzzle import route overrides this limit
// inline (see puzzle.route.js) so it can still accept large batches.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));

// Compress JSON responses (arena leaderboards, competition lists, etc.)
try {
  const { default: compression } = await import("compression");
  app.use(
    compression({
      threshold: 1024,
      filter: (req, res) => {
        const url = req.originalUrl || req.url || "";
        // Live arena JSON is already small or fetched once; gzip is sync zlib on the event loop.
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
app.use("/api/user", userRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/puzzle", puzzleRoutes);
app.use("/api/competition", competitionRoutes);
app.use("/api/live-competition", liveCompetitionRoutes);
app.use("/api/category", categoryRoutes);
app.use("/api/quiz-category", quizCategoryRoutes);
app.use("/api/quiz", quizRoutes);
app.use("/api/exam", examRoutes);

// Support both singular and plural route aliases
app.use("/api/event", eventRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/live-event", liveEventRoutes);
app.use("/api/theme", themeRoutes);
app.use("/api/themes", themeRoutes);
app.use("/api/quote", quoteRoutes);
app.use("/api/quotes", quoteRoutes);
app.use("/api/error-reports", clientErrorReportRoutes);
app.use("/api/client-errors", clientErrorReportRoutes);
app.use("/api/platform-settings", platformSettingsRoutes);

// ===============================
// LEARNING MODULE ROUTE REGISTRATION
// Mounts all learning subsystem routes under /api/learning
// ===============================
app.use("/api/learning", learningRoutes);

app.get("/", (req, res) => {
  return res.status(200).json({ message: "QuickChess4U backend is running" });
});

app.get("/api/ping", (req, res) => {
  return res.status(200).json({ success: true });
});

app.get("/api/health", async (req, res) => {
  const mongoReady = mongoose.connection.readyState === 1;
  let redisReady = false;
  try {
    const pong = await Promise.race([
      redis.ping(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("redis ping timeout")), 500)
      ),
    ]);
    redisReady = pong === "PONG";
  } catch {
    redisReady = false;
  }

  const ok = mongoReady && redisReady;
  return res.status(ok ? 200 : 503).json({
    success: ok,
    mongo: mongoReady ? "up" : "down",
    redis: redisReady ? "up" : "down",
    uptimeSec: Math.floor(process.uptime()),
  });
});

app.get("/api/metrics/cache", (req, res) => {
  return res.json({
    success: true,
    data: {
      ...getMetrics(),
      liveInFlight: getLiveInFlight(),
    },
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

server.timeout = 10 * 60 * 1000; // 10 minutes for large bulk imports

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Socket.IO server initialized`);
});

// Export io for use in other modules
export { io };