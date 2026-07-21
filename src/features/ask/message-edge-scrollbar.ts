export type MessageEdgeScrollbarMetrics = {
  scrollable: boolean;
  maxScrollTop: number;
  thumbHeight: number;
  thumbTop: number;
  maxThumbTop: number;
};

export function calculateMessageEdgeScrollbarMetrics({
  scrollHeight,
  clientHeight,
  scrollTop,
  trackHeight,
  minThumbHeight = 28,
}: {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
  trackHeight: number;
  minThumbHeight?: number;
}): MessageEdgeScrollbarMetrics {
  const safeTrackHeight = Math.max(0, trackHeight);
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
  if (maxScrollTop <= 1 || safeTrackHeight <= 0 || scrollHeight <= 0) {
    return {
      scrollable: false,
      maxScrollTop,
      thumbHeight: safeTrackHeight,
      thumbTop: 0,
      maxThumbTop: 0,
    };
  }

  const thumbHeight = Math.min(
    safeTrackHeight,
    Math.max(minThumbHeight, safeTrackHeight * clientHeight / scrollHeight),
  );
  const maxThumbTop = Math.max(0, safeTrackHeight - thumbHeight);
  const progress = Math.min(1, Math.max(0, scrollTop / maxScrollTop));
  return {
    scrollable: true,
    maxScrollTop,
    thumbHeight,
    thumbTop: progress * maxThumbTop,
    maxThumbTop,
  };
}

export function scrollTopFromMessageEdgeThumb({
  thumbTop,
  maxThumbTop,
  maxScrollTop,
}: {
  thumbTop: number;
  maxThumbTop: number;
  maxScrollTop: number;
}) {
  if (maxThumbTop <= 0 || maxScrollTop <= 0) return 0;
  const progress = Math.min(1, Math.max(0, thumbTop / maxThumbTop));
  return progress * maxScrollTop;
}
