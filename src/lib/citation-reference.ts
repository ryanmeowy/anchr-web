import type { CitationChunk, ConversationCitation } from "./types";

export type CitationLabel = string;

export type ResolvedConversationCitation = {
  citation: ConversationCitation;
  citationPosition: number;
  chunk: CitationChunk;
  label: CitationLabel;
};

export function conversationCitationLabels(citations: ConversationCitation[] | undefined) {
  const labels = new Set<CitationLabel>();
  (citations ?? []).forEach((citation, index) => {
    if (citation.chunks?.length) labels.add(String(citation.citationIndex ?? index + 1));
    citation.chunks?.forEach((chunk) => {
      if (isCitationLabel(chunk.citationLabel)) labels.add(chunk.citationLabel);
    });
  });
  return [...labels];
}

export function resolveConversationCitation(
  citations: ConversationCitation[] | undefined,
  label: CitationLabel,
): ResolvedConversationCitation | undefined {
  const values = citations ?? [];
  for (let citationPosition = 0; citationPosition < values.length; citationPosition += 1) {
    const citation = values[citationPosition];
    const chunk = citation.chunks?.find((item) => item.citationLabel === label);
    if (chunk) return { citation, citationPosition, chunk, label };
  }
  const assetIndex = parseAssetCitationIndex(label);
  const citationPosition = values.findIndex(
    (citation, index) => (citation.citationIndex ?? index + 1) === assetIndex,
  );
  const citation = citationPosition >= 0 ? values[citationPosition] : undefined;
  const chunk = citation?.chunks?.[0];
  return citation && chunk ? { citation, citationPosition, chunk, label } : undefined;
}

export function parseAssetCitationIndex(label: string | null | undefined, fallback = 1) {
  const match = label?.match(/^(\d+)(?:-\d+)?$/);
  const value = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function normalizeCitationLabel(label: string | null | undefined, fallback = "1") {
  return isCitationLabel(label) ? label : fallback;
}

function isCitationLabel(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d+(?:-\d+)?$/.test(value);
}
