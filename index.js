
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
import { ensureAllQuizzesHaveUid } from "./controllers/quiz.controller.js";
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
import raceRoutes from "./routes/race.route.js";
import { initializeRaceSocketHandlers } from "./utils/socketRaceHandlers.js";

import { initCronJobs } from "./utils/cronJobs.js";
import mongoose from "mongoose";
import redis from "./config/redis.js";
import { getMetrics } from "./utils/cacheMetrics.js";
import { getLiveInFlight } from "./middleware/liveLoadGuard.middleware.js";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Config: Connect DB and run bootstrap migrations
await connectDB();

try {
  await ensureAllQuizzesHaveUid();
} catch (err) {
  console.error("[Fatal Startup Error] Quiz UID backfill migration and index sync failed during bootstrap:", err);
  try {
    await mongoose.disconnect();
  } catch (discErr) {
    console.error("Error disconnecting from MongoDB:", discErr);
  }
  process.exit(1);
}

// Start scheduled jobs (after DB is configured)
initCronJobs();

const app = express();
const server = createServer(app);

// Required for correct client IP detection behind proxies / Nginx
app.set("trust proxy", true);

// Middleware - Allowed Origins for CORS
const staticAllowedOrigins = new Set(
  [
    process.env.FRONTEND_URL,
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:3000",
    "http://localhost:4000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:4000",
    "https://quickchess.org",
    "https://www.quickchess.org",
    "http://quickchess.org",
    "http://www.quickchess.org",
    "https://quickchessforyou.com",
    "https://www.quickchessforyou.com",
    "https://test.quickchessforyou.com",
    "https://test-api.quickchessforyou.com",
    "https://api.quickchessforyou.com",
    "https://qcfy-test.netlify.app",
    "https://triklabs.com",
    "https://www.triklabs.com",
    "https://api.triklabs.com",
    "http://triklabs.com",
    "http://api.triklabs.com",
  ].filter(Boolean)
);

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => callback(null, true),
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
initializeRaceSocketHandlers(io);

console.log("FRONTEND_URL =", process.env.FRONTEND_URL);

// Universal Permissive CORS & Preflight Middleware for all requests
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
    "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    req.headers["access-control-request-headers"] ||
      "Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, Pragma, sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform"
  );
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});

app.use(cookieParser()); // Parse cookies from incoming requests
// Security headers (Helmet removed to avoid cross-origin restrictions on login)
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
app.use("/api/error-reports", clientErrorReportRoutes)
app.use("/api/platform-settings", platformSettingsRoutes)
app.use("/api/learning", learningRoutes)
app.use("/api/race", raceRoutes)

app.use("/api/event", liveCompetitionRoutes) // Event routes use same controller as live competitions

app.get("/", (req, res) => {
  return res.status(200).json({ message: "QuickChess4U backend is running" });
})

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


console.log("Chess import:", Chess);

// Global fallback error handler - ensures all error responses include CORS headers
app.use((err, req, res, next) => {
  console.error("[Unhandled Server Error]", err);
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  return res.status(err.status || 500).json({
    message: err.message || "Internal server error",
  });
});

server.timeout = 10 * 60 * 1000; // 10 minutes for large bulk imports

const PORT = Number(process.env.PORT) || 4000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT} (0.0.0.0)`);
  console.log(`Socket.IO server initialized`);
});

// Dual listener: Also listen on fallback port (3000 or 4000) so Nginx proxies on either port work
const fallbackPort = PORT === 4000 ? 3000 : 4000;
try {
  const secondaryServer = createServer(app);
  secondaryServer.listen(fallbackPort, "0.0.0.0", () => {
    console.log(`Secondary HTTP listener active on port ${fallbackPort} (0.0.0.0)`);
  });
  secondaryServer.on("error", (err) => {
    console.log(`Secondary listener on port ${fallbackPort} note: ${err.message}`);
  });
} catch (e) {
  // Ignore fallback error
}

// Optional multi-instance fan-out. Never block HTTP listen on Redis adapter auth.
attachSocketRedisAdapterIfEnabled(io).catch((err) => {
  console.warn("[Socket.IO] Redis adapter skipped:", err?.message || err);
});

async function attachSocketRedisAdapterIfEnabled(ioInstance) {
  const { createSocketRedisAdapter, shouldEnableSocketRedisAdapter } = await import(
    "./config/socketRedisAdapter.js"
  );
  if (!shouldEnableSocketRedisAdapter()) {
    console.log("[Socket.IO] Redis adapter disabled (set SOCKET_IO_REDIS_ADAPTER=true for multi-node)");
    return;
  }
  const { adapter } = await createSocketRedisAdapter();
  ioInstance.adapter(adapter);
  console.log("[Socket.IO] Redis adapter enabled");
}

// Export io for use in other modules
export { io };