import ThemeModel from "../models/ThemeSchema.js";
import PuzzleModel from "../models/PuzzleSchema.js";

const slugify = (text) => {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
};

// Create a new theme
export const createTheme = async (req, res) => {
  try {
    const { name, slug, title, description, icon, displayOrder, isActive } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Name is required" });
    }

    const generatedSlug = slug ? slugify(slug) : slugify(name);

    const existingTheme = await ThemeModel.findOne({
      $or: [
        { name: name.trim() },
        { slug: generatedSlug }
      ]
    });

    if (existingTheme) {
      return res.status(400).json({ message: "Theme with this name or slug already exists" });
    }

    const theme = await ThemeModel.create({
      name: name.trim(),
      slug: generatedSlug,
      title: (title || name).trim(),
      description: (description || "").trim(),
      icon: icon || "FaChess",
      displayOrder: typeof displayOrder === 'number' ? displayOrder : 0,
      isActive: typeof isActive === 'boolean' ? isActive : true,
      createdBy: req.admin?._id,
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
      .sort({ displayOrder: 1, createdAt: -1 })
      .lean();

    // Map themes to include live puzzle counts
    const themesWithCount = themes.map((theme) => ({
      ...theme,
      slug: theme.slug || slugify(theme.name),
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

// Get a single theme by ID or slug
export const getThemeById = async (req, res) => {
  try {
    const { id } = req.params;

    let theme;
    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      theme = await ThemeModel.findById(id).populate("puzzles");
    } else {
      theme = await ThemeModel.findOne({
        $or: [
          { slug: id.toLowerCase().trim() },
          { name: id.trim() }
        ]
      }).populate("puzzles");
    }

    if (!theme) {
      return res.status(404).json({ message: "Theme not found" });
    }

    const themeObject = theme.toObject ? theme.toObject() : theme;
    themeObject.slug = themeObject.slug || slugify(themeObject.name);
    themeObject.totalPuzzles = themeObject.puzzles ? themeObject.puzzles.length : 0;

    res.status(200).json(themeObject);
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
    const { name, slug, title, description, icon, displayOrder, isActive } = req.body;

    const theme = await ThemeModel.findById(id);
    if (!theme) {
      return res.status(404).json({ message: "Theme not found" });
    }

    const newSlug = slug ? slugify(slug) : (name ? slugify(name) : theme.slug);

    if (name && name.trim() !== theme.name) {
      const existingTheme = await ThemeModel.findOne({
        _id: { $ne: id },
        $or: [
          { name: name.trim() },
          { slug: newSlug }
        ]
      });

      if (existingTheme) {
        return res.status(400).json({ message: "Theme with this name or slug already exists" });
      }
    }

    if (name) theme.name = name.trim();
    if (newSlug) theme.slug = newSlug;
    if (title) theme.title = title.trim();
    if (description !== undefined) theme.description = description.trim();
    if (icon) theme.icon = icon;
    if (typeof displayOrder === 'number') theme.displayOrder = displayOrder;
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
