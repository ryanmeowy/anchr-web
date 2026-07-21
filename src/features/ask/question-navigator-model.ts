export function questionMarkerCenter({
  index,
  count,
  trackHeight,
  markerHeight = 12,
}: {
  index: number;
  count: number;
  trackHeight: number;
  markerHeight?: number;
}) {
  if (count <= 0 || trackHeight <= 0) return 0;
  if (count === 1) return trackHeight / 2;
  const usableHeight = Math.max(0, trackHeight - markerHeight);
  const safeIndex = Math.min(count - 1, Math.max(0, index));
  return markerHeight / 2 + usableHeight * safeIndex / (count - 1);
}

export function questionNavigatorNaturalHeight({
  count,
  itemHeight = 12,
  markerHeight = 3,
  markerGap = 10,
}: {
  count: number;
  itemHeight?: number;
  markerHeight?: number;
  markerGap?: number;
}) {
  if (count <= 0) return 0;
  return itemHeight + Math.max(0, count - 1) * (markerHeight + markerGap);
}

export function resolveActiveQuestionIndex({
  questionTops,
  scrollTop,
  clientHeight,
  scrollHeight,
  bottomTolerance = 1,
}: {
  questionTops: Array<number | null>;
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  bottomTolerance?: number;
}) {
  if (questionTops.length === 0) return -1;

  const safeScrollTop = Math.max(0, scrollTop);
  const maximumScrollTop = Math.max(0, scrollHeight - clientHeight);
  const distanceToBottom = Math.max(0, maximumScrollTop - safeScrollTop);
  if (distanceToBottom <= Math.max(0, bottomTolerance)) return questionTops.length - 1;

  const readingAnchor = safeScrollTop + Math.min(120, Math.max(48, clientHeight * 0.22));
  let activeIndex = 0;
  questionTops.forEach((questionTop, index) => {
    if (questionTop !== null && Number.isFinite(questionTop) && questionTop <= readingAnchor) {
      activeIndex = index;
    }
  });
  return activeIndex;
}

export function nearestQuestionMarkerIndex({
  pointerY,
  count,
  trackHeight,
  markerHeight = 12,
}: {
  pointerY: number;
  count: number;
  trackHeight: number;
  markerHeight?: number;
}) {
  if (count <= 0) return -1;
  if (count === 1 || trackHeight <= markerHeight) return 0;
  const usableHeight = trackHeight - markerHeight;
  const progress = Math.min(1, Math.max(0, (pointerY - markerHeight / 2) / usableHeight));
  return Math.round(progress * (count - 1));
}

export function questionWaveInfluence({
  pointerY,
  markerY,
  radius = 44,
}: {
  pointerY: number | null;
  markerY: number;
  radius?: number;
}) {
  if (pointerY === null || radius <= 0) return 0;
  const distance = Math.abs(pointerY - markerY);
  if (distance >= radius) return 0;
  const progress = 1 - distance / radius;
  return progress * progress * (3 - 2 * progress);
}

export function resolveQuestionPreviewId({
  hoveredId,
  keyboardFocusedId,
}: {
  hoveredId: string | null;
  keyboardFocusedId: string | null;
}) {
  return hoveredId ?? keyboardFocusedId;
}
