/**
 * PM2 cluster sets NODE_APP_INSTANCE to "0", "1", ...
 * Fork / local node leaves it unset — treat as primary.
 */
export function isPrimaryWorker() {
  const inst = process.env.NODE_APP_INSTANCE;
  return inst === undefined || inst === "" || inst === "0";
}
