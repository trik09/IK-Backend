export const checkPermission = (resource, action) => {
  return (req, res, next) => {
    try {
      // Admin should exist (placed after isAdmin middleware)
      if (!req.admin) {
        return res.status(401).json({ message: "Unauthorized admin access" });
      }

      // Super admin has all permissions
      if (req.admin.role === "superadmin") {
        return next();
      }

      // Check subadmin permissions
      const permissions = req.admin.permissions;
      if (!permissions || !permissions[resource] || !permissions[resource][action]) {
        return res.status(403).json({ 
          message: `Access denied: You do not have permission to ${action} ${resource}.` 
        });
      }

      return next();
    } catch (error) {
      console.error("Permission check error:", error);
      return res.status(500).json({ message: "Internal server error during permission check" });
    }
  };
};
