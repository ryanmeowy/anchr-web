import type { SegmentIndexStatus } from "./types";

export type IndexCompatibilityIssue =
  | "DIMENSION"
  | "PROFILE"
  | "DIMENSION_AND_PROFILE"
  | null;

export function getIndexCompatibilityIssue(status: SegmentIndexStatus): IndexCompatibilityIssue {
  // A pending target is not active yet; query vectors still use the current model.
  if (status.pendingRebuild) return null;
  const dimensionMismatch =
    status.actualDim != null &&
    status.expectedDim != null &&
    status.actualDim !== status.expectedDim;
  const profileMismatch =
    status.expectedProfileFingerprint != null &&
    status.actualProfileFingerprint !== status.expectedProfileFingerprint;

  if (dimensionMismatch && profileMismatch) return "DIMENSION_AND_PROFILE";
  if (dimensionMismatch) return "DIMENSION";
  if (profileMismatch) return "PROFILE";
  return null;
}

export function hasIndexRebuildFailed(status: SegmentIndexStatus) {
  return status.status === "READY" &&
    (Boolean(status.lastError) || status.rebuildProgress?.phase === "FAILED");
}

export function isIndexFullyOperational(status?: SegmentIndexStatus) {
  return Boolean(
    status &&
    (status.status === "READY" || status.status === "REBUILDING") &&
    status.readable &&
    (status.status === "REBUILDING" || status.writable) &&
    !getIndexCompatibilityIssue(status),
  );
}
