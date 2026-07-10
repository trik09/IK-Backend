import express from "express"
import {
    getQuotes,
    getDailyQuote,
    createQuote,
    bulkImportQuotes,
    updateQuote,
    deleteQuote,
    activateDailyQuote
} from "../controllers/quote.controller.js"
import isAdmin from "../middleware/admin.middleware.js";

const router = express.Router();

router.get("/", getQuotes);
router.get("/daily", getDailyQuote);
router.post("/", isAdmin, createQuote);
router.post("/bulk-import", isAdmin, bulkImportQuotes);
router.put("/:id", isAdmin, updateQuote);
router.delete("/:id", isAdmin, deleteQuote);
router.patch("/:id/activate", isAdmin, activateDailyQuote);

export default router;