const express = require('express');
const router = express.Router();
const Category = require('../models/Category');

// Get all categories
router.get('/categories', async (req, res) => {
  try {
    const categories = await Category.find();
    res.json(categories);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create/Update category
router.post('/categories', async (req, res) => {
  const { name, words } = req.body;
  try {
    let category = await Category.findOne({ name });
    if (category) {
      category.words = words;
      await category.save();
    } else {
      category = new Category({ name, words });
      await category.save();
    }
    res.status(201).json(category);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Delete category
router.delete('/categories/:id', async (req, res) => {
  try {
    await Category.findByIdAndDelete(req.params.id);
    res.json({ message: 'Category deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
