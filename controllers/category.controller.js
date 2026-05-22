import CategoryModel from "../models/CategorySchema.js";
import PuzzleModel from "../models/PuzzleSchema.js";

// Create a new category
export const createCategory = async (req, res) => {
  try {
    const { name, title, description, icon } = req.body;

    // Validate required fields
    // Validate required fields
    if (!name) {
      return res.status(400).json({
        message: "Name is required",
      });
    }

    // Check if category already exists
    const existingCategory = await CategoryModel.findOne({
      name: name.trim()
    });

    if (existingCategory) {
      return res.status(400).json({
        message: "Category with this name already exists",
      });
    }

    // Create new category
    const category = await CategoryModel.create({
      name: name.trim(),
      title: (title || name).trim(),
      description: (description || "").trim(),
      icon: icon || "FaChess",
      createdBy: req.admin._id,
    });

    return res.status(201).json({
      message: "Category created successfully",
      category,
    });
  } catch (error) {
    console.error("Error creating category:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get all categories
export const getCategories = async (req, res) => {
  try {
    const { includeInactive } = req.query;

    const query = includeInactive === 'true' ? {} : { isActive: true };

    const categories = await CategoryModel.find(query)
      .sort({ createdAt: -1 })
      .lean();

    // Get puzzle count for each category
    const categoriesWithCount = await Promise.all(
      categories.map(async (category) => {
        const puzzleCount = await PuzzleModel.countDocuments({
          category: category.name
        });
        return {
          ...category,
          totalPuzzles: puzzleCount,
        };
      })
    );

    res.status(200).json(categoriesWithCount);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({
      message: "Failed to fetch categories",
      error: error.message
    });
  }
};

// Get a single category by ID
export const getCategoryById = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await CategoryModel.findById(id);

    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    // Get puzzle count
    const puzzleCount = await PuzzleModel.countDocuments({
      category: category.name
    });

    res.status(200).json({
      ...category.toObject(),
      totalPuzzles: puzzleCount,
    });
  } catch (error) {
    console.error("Error fetching category:", error);
    res.status(500).json({
      message: "Failed to fetch category",
      error: error.message
    });
  }
};

// Update a category
export const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, title, description, icon, isActive } = req.body;

    const category = await CategoryModel.findById(id);

    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    // If name is being changed, check for duplicates
    if (name && name.trim() !== category.name) {
      const existingCategory = await CategoryModel.findOne({
        name: name.trim(),
        _id: { $ne: id }
      });

      if (existingCategory) {
        return res.status(400).json({
          message: "Category with this name already exists",
        });
      }

      // Update all puzzles with the old category name
      await PuzzleModel.updateMany(
        { category: category.name },
        { category: name.trim() }
      );
    }

    // Update category fields
    if (name) category.name = name.trim();
    if (title) category.title = title.trim();
    if (description) category.description = description.trim();
    if (icon) category.icon = icon;
    if (typeof isActive === 'boolean') category.isActive = isActive;

    await category.save();

    res.status(200).json({
      message: "Category updated successfully",
      category,
    });
  } catch (error) {
    console.error("Error updating category:", error);
    res.status(500).json({
      message: "Failed to update category",
      error: error.message
    });
  }
};

// Delete a category
export const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { deletePuzzles } = req.query; // ?deletePuzzles=true to cascade-delete puzzles

    const category = await CategoryModel.findById(id);

    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    // If confirmed, delete all puzzles in this category first
    if (deletePuzzles === 'true') {
      const puzzleCount = await PuzzleModel.countDocuments({ category: category.name });
      await PuzzleModel.deleteMany({ category: category.name });
      await CategoryModel.findByIdAndDelete(id);
      return res.status(200).json({
        message: `Category deleted along with ${puzzleCount} puzzle(s).`,
        deletedPuzzles: puzzleCount,
      });
    }

    await CategoryModel.findByIdAndDelete(id);

    res.status(200).json({ message: "Category deleted successfully." });
  } catch (error) {
    console.error("Error deleting category:", error);
    res.status(500).json({
      message: "Failed to delete category",
      error: error.message
    });
  }
};

// Get category statistics
export const getCategoryStats = async (req, res) => {
  try {
    const stats = await PuzzleModel.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          avgRating: { $avg: '$rating' }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    const totalCategories = await CategoryModel.countDocuments({ isActive: true });
    const totalPuzzles = await PuzzleModel.countDocuments();

    res.status(200).json({
      totalCategories,
      totalPuzzles,
      categoryBreakdown: stats
    });
  } catch (error) {
    console.error("Error fetching category stats:", error);
    res.status(500).json({
      message: "Failed to fetch statistics",
      error: error.message
    });
  }
};
