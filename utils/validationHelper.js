// Qcfy-BackEnd/utils/validationHelper.js
export const SUPPORTED_VALIDATION_TYPES = [
  "non_attacking_queens",
  "non_attacking_knights",
  "control_center",
  "exact_position_match",
  "mate_in_one",
  "safe_king",
  "custom_rule",
];

/**
 * Returns true if the provided type is one of the supported board‑builder
 * validation types.
 */
export const isValidValidationType = (type) =>
  SUPPORTED_VALIDATION_TYPES.includes(type);

/**
 * Validate the `rules` object for a given validation type.
 * Returns true if the rules meet the minimal expectations for that type.
 */
export const validateRulesForType = (type, rules) => {
  if (typeof rules !== "object" || rules === null) return false;
  return SUPPORTED_VALIDATION_TYPES.includes(type);
};

