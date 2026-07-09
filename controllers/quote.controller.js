import Quote from "../models/quote.js";

export const getQuotes = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const quotes = await Quote.find()
            .sort({ no: 1 })
            .skip(skip)
            .limit(limit);

        const total = await Quote.countDocuments();

        res.status(200).json({
            quotes,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const getDailyQuote = async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const dailyQuote = await Quote.findOne({
            isActive: true,
            displayDate: {
                $gte: today,
                $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
            }
        });

        if (!dailyQuote) {
            return res.status(404).json({ message: "No daily quote found for today" });
        }

        res.status(200).json(dailyQuote);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const createQuote = async (req, res) => {
    try {
        const { quote, author, no } = req.body;
        const newQuote = await Quote.create({ quote, author, no });
        res.status(201).json(newQuote);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const bulkImportQuotes = async (req, res) => {
    try {
        const { quotes } = req.body;

        if (!Array.isArray(quotes) || quotes.length === 0) {
            return res.status(400).json({ message: "Quotes array is required" });
        }

        const validQuotes = quotes.filter(q => q.quote && q.no !== undefined);

        if (validQuotes.length === 0) {
            return res.status(400).json({ message: "No valid quotes provided" });
        }

        const importedQuotes = await Quote.insertMany(validQuotes);

        res.status(201).json({
            message: `Successfully imported ${importedQuotes.length} quotes`,
            quotes: importedQuotes
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const updateQuote = async (req, res) => {
    try {
        const { id } = req.params;
        const { quote, author, isActive, displayDate } = req.body;

        const updatedQuote = await Quote.findByIdAndUpdate(
            id,
            { quote, author, isActive, displayDate },
            { new: true, runValidators: true }
        );

        if (!updatedQuote) {
            return res.status(404).json({ message: "Quote not found" });
        }

        res.status(200).json(updatedQuote);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const deleteQuote = async (req, res) => {
    try {
        const { id } = req.params;

        const deletedQuote = await Quote.findByIdAndDelete(id);

        if (!deletedQuote) {
            return res.status(404).json({ message: "Quote not found" });
        }

        res.status(200).json({ message: "Quote deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const activateDailyQuote = async (req, res) => {
    try {
        const { id } = req.params;
        const { displayDate } = req.body;

        const targetDate = displayDate ? new Date(displayDate) : new Date();
        targetDate.setHours(0, 0, 0, 0);

        await Quote.updateMany(
            { isActive: true },
            { isActive: false }
        );

        const activatedQuote = await Quote.findByIdAndUpdate(
            id,
            {
                isActive: true,
                displayDate: targetDate
            },
            { new: true }
        );

        if (!activatedQuote) {
            return res.status(404).json({ message: "Quote not found" });
        }

        res.status(200).json(activatedQuote);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const rotateDailyQuote = async () => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const existingActiveQuote = await Quote.findOne({
            isActive: true,
            displayDate: {
                $gte: today,
                $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
            }
        });

        if (existingActiveQuote) {
            console.log("[Quote Cron] Daily quote already set for today");
            return;
        }

        await Quote.updateMany({ isActive: true }, { isActive: false });

        const inactiveQuotes = await Quote.find({ isActive: false });
        
        if (inactiveQuotes.length === 0) {
            console.log("[Quote Cron] No quotes available to rotate");
            return;
        }

        const randomQuote = inactiveQuotes[Math.floor(Math.random() * inactiveQuotes.length)];

        await Quote.findByIdAndUpdate(randomQuote._id, {
            isActive: true,
            displayDate: today
        });

        console.log("[Quote Cron] Daily quote rotated successfully:", randomQuote.quote.substring(0, 50) + "...");
    } catch (error) {
        console.error("[Quote Cron] Error rotating daily quote:", error.message);
    }
};