import ThemeModel from "../models/ThemeSchema.js";
import PuzzleModel from "../models/PuzzleSchema.js";

// Create a new theme
export const createTheme = async (req, res) => {
  try {
    const { name, title, description, icon } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Name is required" });
    }

    const existingTheme = await ThemeModel.findOne({ name: name.trim() });
    if (existingTheme) {
      return res.status(400).json({ message: "Theme with this name already exists" });
    }

    const theme = await ThemeModel.create({
      name: name.trim(),
      title: (title || name).trim(),
      description: (description || "").trim(),
      icon: icon || "FaChess",
      createdBy: req.admin._id,
    });

    return res.status(201).json({
      message: "Theme created successfully",
      theme,
    });
  } catch (error) {
    console.error("Error creating theme:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

// Get all themes
export const getThemes = async (req, res) => {
  try {
    const { includeInactive } = req.query;
    const query = includeInactive === 'true' ? {} : { isActive: true };

    const themes = await ThemeModel.find(query)
      .sort({ createdAt: -1 })
      .lean();

    // Map themes to include puzzle counts
    const themesWithCount = themes.map((theme) => ({
      ...theme,
      totalPuzzles: theme.puzzles ? theme.puzzles.length : 0,
    }));

    res.status(200).json(themesWithCount);
  } catch (error) {
    console.error("Error fetching themes:", error);
    res.status(500).json({
      message: "Failed to fetch themes",
      error: error.message
    });
  }
};

// Get a single theme by ID
export const getThemeById = async (req, res) => {
  try {
    const { id } = req.params;

    // We can query by Mongoose ID, or we can search by Name (for public URL friendliness)
    let theme;
    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      theme = await ThemeModel.findById(id).populate("puzzles");
    } else {
      theme = await ThemeModel.findOne({ name: id }).populate("puzzles");
    }

    if (!theme) {
      return res.status(404).json({ message: "Theme not found" });
    }

    res.status(200).json(theme);
  } catch (error) {
    console.error("Error fetching theme:", error);
    res.status(500).json({
      message: "Failed to fetch theme",
      error: error.message
    });
  }
};

// Update a theme
export const updateTheme = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, title, description, icon, isActive } = req.body;

    const theme = await ThemeModel.findById(id);
    if (!theme) {
      return res.status(404).json({ message: "Theme not found" });
    }

    if (name && name.trim() !== theme.name) {
      const existingTheme = await ThemeModel.findOne({
        name: name.trim(),
        _id: { $ne: id }
      });

      if (existingTheme) {
        return res.status(400).json({ message: "Theme with this name already exists" });
      }
    }

    if (name) theme.name = name.trim();
    if (title) theme.title = title.trim();
    if (description) theme.description = description.trim();
    if (icon) theme.icon = icon;
    if (typeof isActive === 'boolean') theme.isActive = isActive;

    await theme.save();

    res.status(200).json({
      message: "Theme updated successfully",
      theme,
    });
  } catch (error) {
    console.error("Error updating theme:", error);
    res.status(500).json({
      message: "Failed to update theme",
      error: error.message
    });
  }
};

// Delete a theme
export const deleteTheme = async (req, res) => {
  try {
    const { id } = req.params;

    const theme = await ThemeModel.findById(id);
    if (!theme) {
      return res.status(404).json({ message: "Theme not found" });
    }

    await ThemeModel.findByIdAndDelete(id);

    res.status(200).json({ message: "Theme deleted successfully." });
  } catch (error) {
    console.error("Error deleting theme:", error);
    res.status(500).json({
      message: "Failed to delete theme",
      error: error.message
    });
  }
};

// Associate puzzles with a theme
export const setThemePuzzles = async (req, res) => {
  try {
    const { id } = req.params;
    const { puzzleIds } = req.body;

    if (!Array.isArray(puzzleIds)) {
      return res.status(400).json({ message: "puzzleIds must be an array" });
    }

    const theme = await ThemeModel.findById(id);
    if (!theme) {
      return res.status(404).json({ message: "Theme not found" });
    }

    theme.puzzles = puzzleIds;
    await theme.save();

    res.status(200).json({
      message: `Theme puzzles updated successfully. Associated ${puzzleIds.length} puzzles.`,
      theme
    });
  } catch (error) {
    console.error("Error setting theme puzzles:", error);
    res.status(500).json({
      message: "Failed to update theme puzzles",
      error: error.message
    });
  }
};
