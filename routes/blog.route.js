import express from "express";
import {
  getPosts,
  getPostBySlug,
  getAdminPosts,
  createPost,
  updatePost,
  deletePost,
} from "../controllers/blog.controller.js";
import isUser from "../middleware/user.middleware.js";
import isAdmin from "../middleware/admin.middleware.js";

const router = express.Router();

// Public routes
router.get("/", getPosts);
router.get("/detail/:slug", getPostBySlug);

// Admin routes
router.get("/admin/all", isAdmin, getAdminPosts);
router.post("/", isAdmin, createPost);
router.put("/:id", isAdmin, updatePost);
router.delete("/:id", isAdmin, deletePost);

export default router;
