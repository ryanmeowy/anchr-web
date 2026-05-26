"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { FileSearch, Globe2, Paperclip, Send, Sparkles } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { KbSelect } from "@/components/ui/kb-select";
import { ErrorBlock, LoadingBlock } from "@/components/ui/query-state";
import { apiClient } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";

export function AskPage() {
  const [query, setQuery] = useState("");
  const [kbId, setKbId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [answer, setAnswer] = useState("");
  const [citations, setCitations] = useState<Array<{ segmentId?: string; snippet?: string; fileName?: string; pageNo?: number }>>([]);

  const kbsQuery = useQuery({
    queryKey: ["kbs"],
    queryFn: () => apiClient.listKnowledgeBases(1, 50),
  });

  const homeQuery = useQuery({
    queryKey: ["home-summary"],
    queryFn: apiClient.homeSummary,
  });

  const kbs = useMemo(() => kbsQuery.data?.items ?? [], [kbsQuery.data?.items]);
  const selectedKbIds = useMemo(() => (kbId ? [kbId] : kbs.slice(0, 3).map((item) => item.id)), [kbId, kbs]);

  const askMutation = useMutation({
    mutationFn: async () => {
      let currentSessionId = sessionId;
      if (!currentSessionId) {
        const session = await apiClient.createConversation({
          title: query.trim().slice(0, 40) || "新的问答",
          kbIds: selectedKbIds,
        });
        currentSessionId = session.sessionId;
        setSessionId(currentSessionId);
      }

      return apiClient.sendMessage(currentSessionId, {
        query: query.trim(),
        kbIds: selectedKbIds,
        answerMode: "grounded",
      });
    },
    onSuccess: (data) => {
      const response = data as {
        answer?: string;
        citations?: Array<{ segmentId?: string; snippet?: string; fileName?: string; pageNo?: number }>;
      };
      setAnswer(response.answer ?? "未生成回答。");
      setCitations(response.citations ?? []);
    },
  });

  return (
    <div className="grid grid-cols-[1fr_360px] gap-6 px-8 py-8">
      <section className="flex min-h-[calc(100vh-138px)] flex-col">
        <div className="mx-auto mt-8 w-full max-w-[820px]">
          <div className="text-center">
            <h1 className="text-[34px] font-semibold tracking-normal text-slate-950">向知识库提问</h1>
            <p className="mt-3 text-base text-slate-500">选择资料范围，获得带引用的可追溯回答。</p>
          </div>

          <div className="panel mt-8 p-4">
            <textarea
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="输入你的问题，例如：报销审批需要哪些材料？"
              className="min-h-28 w-full resize-none border-0 bg-transparent p-2 text-[17px] leading-7 text-slate-950 outline-none placeholder:text-slate-400"
            />
            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
              <div className="flex items-center gap-3">
                <button className="grid size-10 place-items-center rounded-[8px] text-slate-500 hover:bg-slate-50" aria-label="附件">
                  <Paperclip size={19} />
                </button>
                <div className="w-[260px]">
                  <KbSelect items={kbs} value={kbId} onChange={setKbId} compact />
                </div>
                <button className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-slate-200 bg-white px-3 text-sm text-slate-600">
                  <Globe2 size={17} />
                  联网检索
                </button>
              </div>
              <button
                type="button"
                onClick={() => askMutation.mutate()}
                disabled={!query.trim() || askMutation.isPending || selectedKbIds.length === 0}
                className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-300"
              >
                <Send size={17} />
                {askMutation.isPending ? "生成中" : "发送"}
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {["严格问答", "总结", "对比", "仅检索"].map((item) => (
              <button key={item} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                {item}
              </button>
            ))}
          </div>

          {askMutation.error ? <div className="mt-5"><ErrorBlock message={(askMutation.error as Error).message} /></div> : null}

          {answer ? (
            <div className="panel mt-6 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-blue-600">
                <Sparkles size={18} />
                回答
              </div>
              <div className="mt-4 whitespace-pre-wrap text-[16px] leading-8 text-slate-900">{answer}</div>
              {citations.length > 0 ? (
                <div className="mt-5 flex flex-wrap gap-2">
                  {citations.map((citation, index) => (
                    <Link
                      key={`${citation.segmentId ?? index}`}
                      href={citation.segmentId ? `/preview/${citation.segmentId}` : "/ask"}
                      className="rounded-[8px] border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700"
                    >
                      [{index + 1}] {citation.fileName ?? "引用来源"} {citation.pageNo ? `第 ${citation.pageNo} 页` : ""}
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="mt-5 rounded-[8px] bg-amber-50 px-3 py-2 text-sm text-amber-700">未找到可引用证据。</div>
              )}
            </div>
          ) : null}
        </div>
      </section>

      <aside className="space-y-4">
        <div className="panel p-5">
          <h2 className="text-base font-semibold text-slate-950">常用知识库</h2>
          {kbsQuery.isLoading ? <div className="mt-4"><LoadingBlock label="加载中" /></div> : null}
          <div className="mt-4 space-y-3">
            {kbs.slice(0, 4).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setKbId(item.id)}
                className="flex w-full items-center gap-3 rounded-[8px] border border-slate-100 p-3 text-left hover:border-blue-200 hover:bg-blue-50"
              >
                <FileSearch size={18} className="text-blue-600" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900">{item.name}</div>
                  <div className="mt-1 text-xs text-slate-500">{item.documentCount} 个文档</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="panel p-5">
          <h2 className="text-base font-semibold text-slate-950">最近问题</h2>
          {homeQuery.isError ? (
            <div className="mt-4 text-sm text-slate-500">最近问题暂不可用。</div>
          ) : (
            <div className="mt-4 space-y-3">
              {(homeQuery.data?.recentQuestions ?? []).slice(0, 5).map((item) => (
                <div key={item.turnId} className="rounded-[8px] border border-slate-100 p-3">
                  <div className="line-clamp-2 text-sm font-medium text-slate-900">{item.question}</div>
                  <div className="mt-2 text-xs text-slate-500">{formatDateTime(item.createdAt)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
