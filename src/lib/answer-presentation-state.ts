export type AnswerEventPosition = {
  revision: number;
  lastSequence: number;
};

export type PositionedAnswerEvent = {
  revision?: number;
  sequence?: number;
};

export type AnswerEventDecision = AnswerEventPosition & {
  accepted: boolean;
  startsNewRevision: boolean;
};

export function resolveAnswerEventPosition(
  current: AnswerEventPosition,
  event: PositionedAnswerEvent,
): AnswerEventDecision {
  const revision = Math.max(1, event.revision ?? current.revision ?? 1);
  if (revision < current.revision) {
    return { ...current, accepted: false, startsNewRevision: false };
  }
  const startsNewRevision = revision > current.revision;
  const currentSequence = startsNewRevision ? 0 : current.lastSequence;
  const sequence = event.sequence ?? currentSequence + 1;
  if (!startsNewRevision && event.sequence !== undefined && sequence <= current.lastSequence) {
    return { ...current, accepted: false, startsNewRevision: false };
  }
  return {
    revision,
    lastSequence: sequence,
    accepted: true,
    startsNewRevision,
  };
}
