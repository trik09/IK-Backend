import Post from "../models/PostSchema.js";

// Helper to generate a slug from title
const generateSlug = (title) => {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

// ── PUBLIC ENDPOINTS ──────────────────────────────────────────────────────────

// Get list of published news and blogs
export const getPosts = async (req, res) => {
  try {
    const { type, category, tag, search, featured, limit = 10, page = 1 } = req.query;

    const query = { isPublished: true, publishedAt: { $lte: new Date() } };

    if (type) query.type = type;
    if (category) query.category = category;
    if (tag) query.tags = tag;
    if (featured === "true") query.isFeatured = true;

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { content: { $regex: search, $options: "i" } },
      ];
    }

    const limitNum = parseInt(limit);
    const skipNum = (parseInt(page) - 1) * limitNum;

    const posts = await Post.find(query)
      .sort({ isFeatured: -1, publishedAt: -1 })
      .skip(skipNum)
      .limit(limitNum)
      .lean();

    const total = await Post.countDocuments(query);

    return res.status(200).json({
      success: true,
      data: posts,
      pagination: {
        total,
        page: parseInt(page),
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("Error getting posts:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Get single post by slug
export const getPostBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const post = await Post.findOne({ slug });

    if (!post) {
      return res.status(404).json({ success: false, message: "Article not found" });
    }

    // Increment views
    post.views += 1;
    await post.save();

    // Fetch related articles (same category, different slug)
    const related = await Post.find({
      category: post.category,
      slug: { $ne: post.slug },
      isPublished: true,
    })
      .limit(3)
      .lean();

    return res.status(200).json({
      success: true,
      data: post,
      related,
    });
  } catch (error) {
    console.error("Error getting post detail:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// ── ADMIN ENDPOINTS ───────────────────────────────────────────────────────────

// Get all posts for admin (includes draft & scheduled posts)
export const getAdminPosts = async (req, res) => {
  try {
    const posts = await Post.find().sort({ createdAt: -1 }).lean();
    return res.status(200).json({ success: true, data: posts });
  } catch (error) {
    console.error("Error getting admin posts:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Create a news or blog post
export const createPost = async (req, res) => {
  try {
    const {
      title,
      type,
      content,
      coverImage,
      authorName,
      authorRole,
      authorAvatar,
      category,
      tags,
      isPublished,
      isFeatured,
      publishedAt,
      readingTime,
      seoTitle,
      seoDescription,
    } = req.body;

    if (!title || !type || !content) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    let slug = generateSlug(title);
    // Handle duplicate slugs by appending unique timestamp
    const slugExists = await Post.findOne({ slug });
    if (slugExists) {
      slug = `${slug}-${Date.now().toString().slice(-4)}`;
    }

    const newPost = new Post({
      title,
      slug,
      type,
      content,
      coverImage,
      author: {
        name: authorName || "Admin",
        role: authorRole || "Author",
        avatar: authorAvatar || "",
      },
      category: category || "General",
      tags: tags || [],
      isPublished: isPublished ?? false,
      isFeatured: isFeatured ?? false,
      publishedAt: publishedAt || new Date(),
      readingTime: readingTime || Math.max(1, Math.ceil(content.split(" ").length / 200)),
      seoTitle: seoTitle || title,
      seoDescription: seoDescription || content.substring(0, 150).replace(/<[^>]*>/g, ""),
    });

    await newPost.save();

    return res.status(201).json({
      success: true,
      message: "Post created successfully",
      data: newPost,
    });
  } catch (error) {
    console.error("Error creating post:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Edit a post
export const updatePost = async (req, res) => {
  try {
    const { id } = req.params;
    const post = await Post.findById(id);

    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const {
      title,
      type,
      content,
      coverImage,
      authorName,
      authorRole,
      authorAvatar,
      category,
      tags,
      isPublished,
      isFeatured,
      publishedAt,
      readingTime,
      seoTitle,
      seoDescription,
    } = req.body;

    if (title && title !== post.title) {
      let newSlug = generateSlug(title);
      const slugExists = await Post.findOne({ slug: newSlug, _id: { $ne: id } });
      post.slug = slugExists ? `${newSlug}-${Date.now().toString().slice(-4)}` : newSlug;
      post.title = title;
    }

    if (type) post.type = type;
    if (content) {
      post.content = content;
      post.readingTime = readingTime || Math.max(1, Math.ceil(content.split(" ").length / 200));
    }
    if (coverImage !== undefined) post.coverImage = coverImage;
    if (authorName) post.author.name = authorName;
    if (authorRole) post.author.role = authorRole;
    if (authorAvatar !== undefined) post.author.avatar = authorAvatar;
    if (category) post.category = category;
    if (tags) post.tags = tags;
    if (isPublished !== undefined) post.isPublished = isPublished;
    if (isFeatured !== undefined) post.isFeatured = isFeatured;
    if (publishedAt) post.publishedAt = publishedAt;
    if (seoTitle) post.seoTitle = seoTitle;
    if (seoDescription) post.seoDescription = seoDescription;

    await post.save();

    return res.status(200).json({
      success: true,
      message: "Post updated successfully",
      data: post,
    });
  } catch (error) {
    console.error("Error updating post:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Delete a post
export const deletePost = async (req, res) => {
  try {
    const { id } = req.params;
    const post = await Post.findByIdAndDelete(id);

    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    return res.status(200).json({ success: true, message: "Post deleted successfully" });
  } catch (error) {
    console.error("Error deleting post:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
