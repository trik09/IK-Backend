import ClientErrorReport from "../models/ClientErrorReportSchema.js";

const ALLOWED_SOURCES = new Set([
  "exam",
  "competition",
  "event",
  "quiz",
  "puzzle",
  "learning",
  "admin",
  "other",
]);
const ALLOWED_STATUSES = new Set(["new", "reviewed", "resolved"]);

const truncate = (value, max) => {
  if (value == null) return undefined;
  const str = String(value);
  return str.length > max ? str.slice(0, max) : str;
};

const normalizeCapturedErrors = (errors) => {
  if (!Array.isArray(errors)) return [];
  return errors.slice(-20).map((entry) => ({
    message: truncate(entry?.message || "Unknown error", 2000),
    stack: truncate(entry?.stack || "", 8000),
    context: truncate(entry?.context || "", 500),
    timestamp: entry?.timestamp ? new Date(entry.timestamp) : new Date(),
  }));
};

export const createClientErrorReport = async (req, res) => {
  try {
    const {
      source,
      reporterRole: reqReporterRole,
      module: reqModule,
      entityId,
      entityName,
      itemId,
      message,
      stack,
      userNote,
      errors,
      url,
      userAgent,
    } = req.body || {};

    const effectiveSource = source && ALLOWED_SOURCES.has(source) ? source : "other";

    const isReqAdmin = Boolean(
      req.admin ||
        req.user?.role === "admin" ||
        req.user?.role === "superadmin" ||
        reqReporterRole === "admin"
    );
    const reporterRole = isReqAdmin ? "admin" : "user";

    const primaryMessage =
      truncate(message, 2000) ||
      truncate(errors?.[0]?.message, 2000) ||
      truncate(userNote, 2000);

    if (!primaryMessage) {
      return res.status(400).json({
        success: false,
        message: "message or userNote is required",
      });
    }

    const report = await ClientErrorReport.create({
      source: effectiveSource,
      reporterRole,
      module: truncate(reqModule || (url ? new URL(url, "http://localhost").pathname : undefined), 100),
      entityId: truncate(entityId, 100),
      entityName: truncate(entityName, 300),
      itemId: truncate(itemId, 100),
      message: primaryMessage,
      stack: truncate(stack || errors?.[0]?.stack || "", 8000),
      userNote: truncate(userNote, 2000),
      capturedErrors: normalizeCapturedErrors(errors),
      url: truncate(url, 2000),
      userAgent: truncate(userAgent || req.headers["user-agent"], 1000),
      user: req.user?._id,
      username: truncate(
        req.admin?.email || req.user?.username || req.user?.name || req.user?.email || (isReqAdmin ? "Admin" : ""),
        200
      ),
    });

    return res.status(201).json({
      success: true,
      message: "Error report saved",
      data: { id: report._id },
    });
  } catch (error) {
    console.error("createClientErrorReport:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to save error report",
    });
  }
};

export const getClientErrorReports = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.source && ALLOWED_SOURCES.has(req.query.source)) {
      filter.source = req.query.source;
    }
    if (req.query.status && ALLOWED_STATUSES.has(req.query.status)) {
      filter.status = req.query.status;
    }

    const reporterRoleParam = req.query.reporterRole || req.query.reporterType;
    if (reporterRoleParam === "admin") {
      filter.reporterRole = "admin";
    } else if (reporterRoleParam === "user") {
      filter.$or = [{ reporterRole: "user" }, { reporterRole: { $exists: false } }];
    }

    if (req.query.entityId) {
      filter.entityId = String(req.query.entityId);
    }
    if (req.query.search) {
      const search = String(req.query.search).trim();
      if (search) {
        const searchRegex = { $regex: search, $options: "i" };
        const searchConditions = [
          { message: searchRegex },
          { userNote: searchRegex },
          { username: searchRegex },
          { entityName: searchRegex },
          { module: searchRegex },
        ];
        if (filter.$or) {
          filter.$and = [{ $or: filter.$or }, { $or: searchConditions }];
          delete filter.$or;
        } else {
          filter.$or = searchConditions;
        }
      }
    }

    const [reports, total] = await Promise.all([
      ClientErrorReport.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("user", "username name email")
        .lean(),
      ClientErrorReport.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      reports,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error("getClientErrorReports:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch error reports",
    });
  }
};

export const getClientErrorReportById = async (req, res) => {
  try {
    const report = await ClientErrorReport.findById(req.params.id)
      .populate("user", "username name email")
      .lean();

    if (!report) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }

    return res.status(200).json({ success: true, report });
  } catch (error) {
    console.error("getClientErrorReportById:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch error report",
    });
  }
};

export const updateClientErrorReportStatus = async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!status || !ALLOWED_STATUSES.has(status)) {
      return res.status(400).json({
        success: false,
        message: "status must be one of: new, reviewed, resolved",
      });
    }

    const report = await ClientErrorReport.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    )
      .populate("user", "username name email")
      .lean();

    if (!report) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }

    return res.status(200).json({ success: true, report });
  } catch (error) {
    console.error("updateClientErrorReportStatus:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update report status",
    });
  }
};

export const deleteClientErrorReport = async (req, res) => {
  try {
    const report = await ClientErrorReport.findByIdAndDelete(req.params.id);
    if (!report) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }
    return res.status(200).json({ success: true, message: "Report deleted" });
  } catch (error) {
    console.error("deleteClientErrorReport:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to delete report",
    });
  }
};
