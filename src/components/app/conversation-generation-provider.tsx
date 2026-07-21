"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createTypewriterController, type TypewriterController } from "@/lib/typewriter-controller";
import type {
  AgentTask,
  ConversationAnswerStatus,
  ConversationCitation,
  ConversationExecutionMode,
  ConversationIntent,
} from "@/lib/types";

export type ConversationGenerationPhase =
  | "receiving"
  | "processing"
  | "presenting"
  | "completed"
  | "error"
  | "cancelled";

export type ConversationGenerationSnapshot = {
  id: string;
  sessionId: string;
  userMessageId: string;
  assistantMessageId: string;
  query: string;
  phase: ConversationGenerationPhase;
  renderedAnswer: string;
  turnId?: string;
  assetScope: string[];
  answerMode?: string;
  answerStatus?: ConversationAnswerStatus;
  answerFallbackReason?: string | null;
  citations: ConversationCitation[];
  intent?: ConversationIntent;
  executionMode: ConversationExecutionMode;
  agentRunId?: string;
  workflowVersion?: string;
  agentTask?: AgentTask;
  error?: string;
  updatedAt: number;
};

export type ConversationGenerationMatch = {
  id?: string;
  sessionId?: string;
  turnId?: string;
  runId?: string;
  taskId?: string;
};

export type ConversationGenerationHandle = {
  id: string;
  controller: AbortController;
  writer: TypewriterController;
};

type BeginConversationGeneration = Omit<
  ConversationGenerationSnapshot,
  "phase" | "renderedAnswer" | "citations" | "updatedAt"
> & {
  phase?: ConversationGenerationPhase;
  renderedAnswer?: string;
  citations?: ConversationCitation[];
};

type GenerationResource = {
  controller: AbortController;
  writer: TypewriterController;
};

type ConversationGenerationContextValue = {
  generations: ConversationGenerationSnapshot[];
  acquirePresentation: () => () => void;
  beginGeneration: (input: BeginConversationGeneration) => ConversationGenerationHandle;
  updateGeneration: (
    id: string,
    patch: Partial<ConversationGenerationSnapshot>
      | ((current: ConversationGenerationSnapshot) => Partial<ConversationGenerationSnapshot>),
  ) => void;
  findGeneration: (match: ConversationGenerationMatch) => ConversationGenerationSnapshot | undefined;
  getGenerationHandle: (match: ConversationGenerationMatch) => ConversationGenerationHandle | undefined;
  finishGeneration: (id: string) => Promise<void>;
  cancelGeneration: (id: string, phase?: "cancelled" | "error") => void;
  releaseGeneration: (id: string) => void;
};

const ConversationGenerationContext = createContext<ConversationGenerationContextValue | null>(null);
const MAX_GENERATIONS = 8;

function matchesGeneration(
  generation: ConversationGenerationSnapshot,
  match: ConversationGenerationMatch,
) {
  const hasStableIdentity = Boolean(match.id || match.runId || match.taskId || match.turnId);
  if (hasStableIdentity) {
    return Boolean(
      (match.id && generation.id === match.id)
      || (match.runId && generation.agentRunId === match.runId)
      || (match.taskId && generation.agentTask?.taskId === match.taskId)
      || (match.turnId && generation.turnId === match.turnId),
    );
  }
  return Boolean(match.sessionId && generation.sessionId === match.sessionId);
}

export function ConversationGenerationProvider({ children }: { children: ReactNode }) {
  const [generations, setGenerations] = useState<ConversationGenerationSnapshot[]>([]);
  const generationsRef = useRef(generations);
  const resourcesRef = useRef(new Map<string, GenerationResource>());
  const presentationConsumersRef = useRef(0);

  const commit = useCallback((updater: (
    current: ConversationGenerationSnapshot[],
  ) => ConversationGenerationSnapshot[]) => {
    const next = updater(generationsRef.current);
    if (next === generationsRef.current) return;
    generationsRef.current = next;
    setGenerations(next);
  }, []);

  const updateGeneration = useCallback<ConversationGenerationContextValue["updateGeneration"]>((id, patch) => {
    commit((current) => {
      const index = current.findIndex((generation) => generation.id === id);
      if (index < 0) return current;
      const generation = current[index];
      const resolved = typeof patch === "function" ? patch(generation) : patch;
      const next = [...current];
      next[index] = { ...generation, ...resolved, id, updatedAt: Date.now() };
      return next;
    });
  }, [commit]);

  const releaseGeneration = useCallback((id: string) => {
    const resource = resourcesRef.current.get(id);
    resource?.writer.cancel();
    resource?.controller.abort();
    resourcesRef.current.delete(id);
    commit((current) => current.some((generation) => generation.id === id)
      ? current.filter((generation) => generation.id !== id)
      : current);
  }, [commit]);

  const beginGeneration = useCallback<ConversationGenerationContextValue["beginGeneration"]>((input) => {
    const existing = resourcesRef.current.get(input.id);
    existing?.writer.cancel();
    existing?.controller.abort();

    const controller = new AbortController();
    const writer = createTypewriterController({
      initialText: input.renderedAnswer ?? "",
      onRender: (renderedAnswer) => {
        updateGeneration(input.id, (current) => ({
          renderedAnswer,
          phase: current.phase === "completed" ? "completed" : "presenting",
        }));
      },
    });
    if (presentationConsumersRef.current === 0) writer.pause();
    resourcesRef.current.set(input.id, { controller, writer });

    const snapshot: ConversationGenerationSnapshot = {
      ...input,
      phase: input.phase ?? "receiving",
      renderedAnswer: input.renderedAnswer ?? "",
      citations: input.citations ?? [],
      updatedAt: Date.now(),
    };
    commit((current) => [
      ...current.filter((generation) => generation.id !== input.id),
      snapshot,
    ].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, MAX_GENERATIONS));
    const retainedIds = new Set(generationsRef.current.map((generation) => generation.id));
    resourcesRef.current.forEach((resource, id) => {
      if (retainedIds.has(id)) return;
      resource.writer.cancel();
      resource.controller.abort();
      resourcesRef.current.delete(id);
    });
    return { id: input.id, controller, writer };
  }, [commit, updateGeneration]);

  const acquirePresentation = useCallback(() => {
    presentationConsumersRef.current += 1;
    if (presentationConsumersRef.current === 1) {
      resourcesRef.current.forEach(({ writer }) => writer.resume());
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      presentationConsumersRef.current = Math.max(0, presentationConsumersRef.current - 1);
      if (presentationConsumersRef.current === 0) {
        resourcesRef.current.forEach(({ writer }) => writer.pause());
      }
    };
  }, []);

  const findGeneration = useCallback((match: ConversationGenerationMatch) => (
    generationsRef.current.find((generation) => matchesGeneration(generation, match))
  ), []);

  const getGenerationHandle = useCallback((match: ConversationGenerationMatch) => {
    const generation = generationsRef.current.find((item) => matchesGeneration(item, match));
    if (!generation) return undefined;
    const resource = resourcesRef.current.get(generation.id);
    return resource ? { id: generation.id, ...resource } : undefined;
  }, []);

  const finishGeneration = useCallback(async (id: string) => {
    const resource = resourcesRef.current.get(id);
    if (!resource) return;
    await resource.writer.finish();
  }, []);

  const cancelGeneration = useCallback<ConversationGenerationContextValue["cancelGeneration"]>((id, phase = "cancelled") => {
    const resource = resourcesRef.current.get(id);
    resource?.writer.cancel();
    resource?.controller.abort();
    resourcesRef.current.delete(id);
    updateGeneration(id, {
      phase,
      answerStatus: phase === "cancelled" ? "CANCELLED" : undefined,
    });
  }, [updateGeneration]);

  useEffect(() => {
    const resources = resourcesRef.current;
    return () => {
      resources.forEach(({ controller, writer }) => {
        writer.cancel();
        controller.abort();
      });
      resources.clear();
    };
  }, []);

  const value = useMemo<ConversationGenerationContextValue>(() => ({
    generations,
    acquirePresentation,
    beginGeneration,
    updateGeneration,
    findGeneration,
    getGenerationHandle,
    finishGeneration,
    cancelGeneration,
    releaseGeneration,
  }), [
    acquirePresentation,
    beginGeneration,
    cancelGeneration,
    findGeneration,
    getGenerationHandle,
    finishGeneration,
    generations,
    releaseGeneration,
    updateGeneration,
  ]);

  return (
    <ConversationGenerationContext.Provider value={value}>
      {children}
    </ConversationGenerationContext.Provider>
  );
}

export function useConversationGenerations() {
  const context = useContext(ConversationGenerationContext);
  if (!context) {
    throw new Error("useConversationGenerations must be used within ConversationGenerationProvider");
  }
  return context;
}
