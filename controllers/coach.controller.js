import Coach from "../models/CoachSchema.js";
import CoachInquiry from "../models/CoachInquirySchema.js";

// ── MEMBER / VISITOR ENDPOINTS ───────────────────────────────────────────────────

// Submit application to Become a Coach
export const applyBecomeCoach = async (req, res) => {
  try {
    const {
      fullName,
      email,
      mobile,
      whatsapp,
      profilePhoto,
      coverImage,
      country,
      state,
      city,
      languages,
      chessTitle,
      fideRating,
      chessComRating,
      lichessRating,
      experienceYears,
      specializations,
      shortBio,
      about,
      coachingStyle,
      hourlyFee,
      monthlyPackage,
      availableDays,
      availableTimeSlots,
      timeZone,
      demoAvailable,
      studentsCoached,
      achievements,
      certificates,
      resumeUrl,
      youtube,
      instagram,
      chessCom,
      lichess,
      website,
    } = req.body;

    if (!fullName || !email || !country || !experienceYears || !shortBio || !about || !hourlyFee) {
      return res.status(400).json({ success: false, message: "Please fill in all required fields." });
    }

    const application = new Coach({
      fullName,
      email,
      mobile,
      whatsapp,
      profilePhoto,
      coverImage,
      country,
      state,
      city,
      languages: languages || [],
      chessTitle: chessTitle || "None",
      fideRating: fideRating || 0,
      chessComRating: chessComRating || 0,
      lichessRating: lichessRating || 0,
      experienceYears: experienceYears || 0,
      specializations: specializations || [],
      shortBio,
      about,
      coachingStyle,
      hourlyFee,
      monthlyPackage,
      availableDays: availableDays || [],
      availableTimeSlots: availableTimeSlots || [],
      timeZone,
      demoAvailable: demoAvailable ?? false,
      studentsCoached: studentsCoached || 0,
      achievements: achievements || [],
      certificates: certificates || [],
      resumeUrl,
      socialLinks: {
        youtube: youtube || "",
        instagram: instagram || "",
        chessCom: chessCom || "",
        lichess: lichess || "",
        website: website || "",
      },
      status: "pending", // ALWAYS pending initially
    });

    await application.save();

    return res.status(201).json({
      success: true,
      message: "Your application has been submitted successfully and is currently under admin review.",
    });
  } catch (error) {
    console.error("Error creating coach application:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Hire a Coach: Get approved and active coaches with filtering, search, sorting
export const getMarketplaceCoaches = async (req, res) => {
  try {
    const {
      search,
      title,
      specialization,
      language,
      country,
      minPrice,
      maxPrice,
      demo,
      sortBy, // 'price_asc', 'price_desc', 'experience', 'rating'
    } = req.query;

    const query = { status: "approved" };

    if (title) query.chessTitle = title;
    if (specialization) query.specializations = specialization;
    if (language) query.languages = language;
    if (country) query.country = country;
    if (demo === "true") query.demoAvailable = true;

    // Price range filtering
    if (minPrice || maxPrice) {
      query.hourlyFee = {};
      if (minPrice) query.hourlyFee.$gte = parseInt(minPrice);
      if (maxPrice) query.hourlyFee.$lte = parseInt(maxPrice);
    }

    // Name or specialization text search
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: "i" } },
        { shortBio: { $regex: search, $options: "i" } },
        { specializations: { $regex: search, $options: "i" } },
      ];
    }

    let sortOption = { isFeatured: -1, createdAt: -1 };
    if (sortBy === "price_asc") sortOption = { hourlyFee: 1 };
    else if (sortBy === "price_desc") sortOption = { hourlyFee: -1 };
    else if (sortBy === "experience") sortOption = { experienceYears: -1 };
    else if (sortBy === "rating") sortOption = { fideRating: -1 };

    const coaches = await Coach.find(query).sort(sortOption).lean();

    return res.status(200).json({ success: true, data: coaches });
  } catch (error) {
    console.error("Error fetching marketplace coaches:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Get single Coach public profile
export const getCoachProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const coach = await Coach.findOne({ _id: id, status: "approved" }).lean();

    if (!coach) {
      return res.status(404).json({ success: false, message: "Coach profile not found" });
    }

    return res.status(200).json({ success: true, data: coach });
  } catch (error) {
    console.error("Error fetching coach details:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Submit Coaching Inquiry
export const createCoachInquiry = async (req, res) => {
  try {
    const {
      coachId,
      studentName,
      email,
      phone,
      whatsapp,
      country,
      age,
      currentRating,
      targetRating,
      playingLevel,
      preferredLanguage,
      preferredTime,
      classType,
      classesRequired,
      goals,
      additionalNotes,
    } = req.body;

    if (!coachId || !studentName || !email) {
      return res.status(400).json({ success: false, message: "Please fill in all required fields." });
    }

    // Verify coach exists
    const coach = await Coach.findById(coachId);
    if (!coach) {
      return res.status(404).json({ success: false, message: "Selected coach not found." });
    }

    const inquiry = new CoachInquiry({
      coach: coachId,
      studentName,
      email,
      phone,
      whatsapp,
      country,
      age,
      currentRating: currentRating || 0,
      targetRating: targetRating || 0,
      playingLevel,
      preferredLanguage,
      preferredTime,
      classType: classType || "Online",
      classesRequired: classesRequired || 1,
      goals,
      additionalNotes,
      status: "pending",
    });

    await inquiry.save();

    return res.status(201).json({
      success: true,
      message: "Your inquiry has been submitted successfully. Our coordinators will contact you soon!",
    });
  } catch (error) {
    console.error("Error creating coach inquiry:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// ── ADMIN ENDPOINTS ───────────────────────────────────────────────────────────

// Fetch all coaches applications (filterable by status)
export const getAdminCoaches = async (req, res) => {
  try {
    const { status } = req.query;
    const query = {};
    if (status) query.status = status;

    const coaches = await Coach.find(query).sort({ createdAt: -1 }).lean();
    return res.status(200).json({ success: true, data: coaches });
  } catch (error) {
    console.error("Error getting admin coaches:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Update application status / profile / internal notes
export const updateCoachStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, isFeatured, isVerified, internalNotes, ...updateData } = req.body;

    const coach = await Coach.findById(id);
    if (!coach) {
      return res.status(404).json({ success: false, message: "Coach profile not found." });
    }

    if (status) coach.status = status;
    if (isFeatured !== undefined) coach.isFeatured = isFeatured;
    if (isVerified !== undefined) coach.isVerified = isVerified;
    if (internalNotes !== undefined) coach.internalNotes = internalNotes;

    // Apply any additional profile updates (e.g. edit profile)
    Object.keys(updateData).forEach((key) => {
      coach[key] = updateData[key];
    });

    await coach.save();

    return res.status(200).json({
      success: true,
      message: "Coach application updated successfully.",
      data: coach,
    });
  } catch (error) {
    console.error("Error updating coach application:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Delete coach record completely
export const deleteCoachRecord = async (req, res) => {
  try {
    const { id } = req.params;
    const coach = await Coach.findByIdAndDelete(id);

    if (!coach) {
      return res.status(404).json({ success: false, message: "Coach record not found." });
    }

    return res.status(200).json({ success: true, message: "Coach profile deleted from system." });
  } catch (error) {
    console.error("Error deleting coach profile:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Get list of coach inquiries for admin
export const getAdminInquiries = async (req, res) => {
  try {
    const inquiries = await CoachInquiry.find()
      .populate("coach", "fullName email chessTitle hourlyFee")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, data: inquiries });
  } catch (error) {
    console.error("Error getting inquiries:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Update status & notes of coach inquiries
export const updateInquiryStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, internalNotes } = req.body;

    const inquiry = await CoachInquiry.findById(id);
    if (!inquiry) {
      return res.status(404).json({ success: false, message: "Inquiry not found." });
    }

    if (status) inquiry.status = status;
    if (internalNotes !== undefined) inquiry.internalNotes = internalNotes;

    await inquiry.save();

    return res.status(200).json({
      success: true,
      message: "Inquiry updated successfully.",
      data: inquiry,
    });
  } catch (error) {
    console.error("Error updating inquiry:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
