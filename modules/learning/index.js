import express from "express";
import userRoutes from "./routes/user.routes.js";
import adminRoutes from "./routes/admin.routes.js";

const router = express.Router();

router.use("/", userRoutes);
router.use("/admin", adminRoutes);

export default router;
