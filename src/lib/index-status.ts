import type { SegmentIndexStatus } from "./types";

export type IndexCompatibilityIssue =
  | "DIMENSION"
  | "PROFILE"
  | "DIMENSION_AND_PROFILE"
  | null;

export function getIndexCompatibilityIssue(status: SegmentIndexStatus): IndexCompatibilityIssue {
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
    status.status === "READY" &&
    status.readable &&
    status.writable &&
    !status.pendingRebuild &&
    !hasIndexRebuildFailed(status) &&
    !getIndexCompatibilityIssue(status),
  );
}
