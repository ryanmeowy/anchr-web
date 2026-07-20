export type PreviewMessageScrollMetrics = {
  currentScrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  messageTopInViewport: number;
  messageHeight: number;
  savedViewportOffset?: number;
};

export function resolvePreviewMessageScrollTop({
  currentScrollTop,
  scrollHeight,
  clientHeight,
  messageTopInViewport,
  messageHeight,
  savedViewportOffset,
}: PreviewMessageScrollMetrics) {
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
  const desiredViewportOffset = typeof savedViewportOffset === "number" && Number.isFinite(savedViewportOffset)
    ? savedViewportOffset
    : Math.max(0, (clientHeight - messageHeight) / 2);

  return clamp(
    currentScrollTop + messageTopInViewport - desiredViewportOffset,
    0,
    maxScrollTop,
  );
}

export function clampPreviewMessageScrollTop(scrollTop: number, scrollHeight: number, clientHeight: number) {
  return clamp(scrollTop, 0, Math.max(0, scrollHeight - clientHeight));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
