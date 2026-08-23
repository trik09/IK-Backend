import CourseCategory from "../models/CourseCategorySchema.js";

/**
 * GET /api/course-category
 * List all course categories (optionally filter by isActive).
 */
export const getCategories = async (req, res) => {
  try {
    const { activeOnly } = req.query;
    const filter = activeOnly === "true" ? { isActive: true } : {};

    const categories = await CourseCategory.find(filter).sort({ sortOrder: 1, name: 1 });

    return res.status(200).json({ success: true, data: categories });
  } catch (err) {
    console.error("getCategories error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * GET /api/course-category/:id
 */
export const getCategoryById = async (req, res) => {
  try {
    const category = await CourseCategory.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found." });
    }
    return res.status(200).json({ success: true, data: category });
  } catch (err) {
    console.error("getCategoryById error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * POST /api/course-category
 * Create a new course category. (Admin only)
 */
export const createCategory = async (req, res) => {
  try {
    const { name, slug, description, icon, color, sortOrder } = req.body;

    if (!name || !slug) {
      return res.status(400).json({ success: false, message: "Name and slug are required." });
    }

    // Check slug uniqueness
    const existing = await CourseCategory.findOne({ slug: slug.toLowerCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: "A category with this slug already exists." });
    }

    const category = await CourseCategory.create({
      name,
      slug: slug.toLowerCase(),
      description: description || "",
      icon: icon || "",
      color: color || "#b58863",
      sortOrder: sortOrder || 0,
    });

    return res.status(201).json({ success: true, data: category });
  } catch (err) {
    console.error("createCategory error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * PUT /api/course-category/:id
 * Update a course category. (Admin only)
 */
export const updateCategory = async (req, res) => {
  try {
    const { name, slug, description, icon, color, sortOrder, isActive } = req.body;

    const category = await CourseCategory.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found." });
    }

    // Check slug uniqueness if changed
    if (slug && slug.toLowerCase() !== category.slug) {
      const existing = await CourseCategory.findOne({ slug: slug.toLowerCase() });
      if (existing) {
        return res.status(400).json({ success: false, message: "A category with this slug already exists." });
      }
      category.slug = slug.toLowerCase();
    }

    if (name !== undefined) category.name = name;
    if (description !== undefined) category.description = description;
    if (icon !== undefined) category.icon = icon;
    if (color !== undefined) category.color = color;
    if (sortOrder !== undefined) category.sortOrder = sortOrder;
    if (isActive !== undefined) category.isActive = isActive;

    await category.save();

    return res.status(200).json({ success: true, data: category });
  } catch (err) {
    console.error("updateCategory error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};

/**
 * DELETE /api/course-category/:id
 * Delete a course category. (Admin only)
 */
export const deleteCategory = async (req, res) => {
  try {
    const category = await CourseCategory.findByIdAndDelete(req.params.id);
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found." });
    }
    return res.status(200).json({ success: true, message: "Category deleted." });
  } catch (err) {
    console.error("deleteCategory error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
};
