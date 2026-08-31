/** Resolve the acting admin's ObjectId for createdBy / audit fields. */
export function getAdminActorId(admin) {
  if (!admin) return undefined;
  return admin._id || admin.id || undefined;
}
