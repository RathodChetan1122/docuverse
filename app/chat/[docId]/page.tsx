"use client";

import { useState, useRef, useEffect, use } from "react";
import { useRouter } from "next/navigation";

interface Source {
  page: number;
  excerpt: string;
  score: number;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  isSummary?: boolean;
}

function getSessionId(): string {
  if (typeof window === "undefined") return "default";
  return sessionStorage.getItem("docuverse_session") || "default";
}

export default function ChatPage({ params }: { params: Promise<{ docId: string }> }) {
  const { docId } = use(params);
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [docName, setDocName] = useState("Document");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const name = sessionStorage.getItem(`doc_name_${docId}`);
    if (name) setDocName(name);
  }, [docId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function handleSummarize() {
    if (summarizing || loading) return;
    setSummarizing(true);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: "Summarize this document" },
      { role: "assistant", content: "", isSummary: true },
    ]);
    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Summarization failed");
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1].content = data.summary;
        return updated;
      });
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1].content = "Could not generate summary. Please try again.";
        return updated;
      });
    } finally {
      setSummarizing(false);
    }
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;
    const question = input.trim();
    setInput("");
    setLoading(true);
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setMessages((prev) => [...prev, { role: "assistant", content: "", sources: [] }]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, docId, sessionId: getSessionId() }),
      });
      if (!res.ok) throw new Error("Chat request failed");
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === "sources") {
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1].sources = parsed.sources;
                return updated;
              });
            } else if (parsed.type === "token") {
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1].content += parsed.token;
                return updated;
              });
            }
          } catch { }
        }
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1].content = "Something went wrong. Please try again.";
        return updated;
      });
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const isLoading = loading || summarizing;

  return (
    <main className="h-screen bg-[#080810] text-white flex flex-col">
      <header className="border-b border-white/5 px-6 py-4 flex items-center gap-4 flex-shrink-0">
        <button onClick={() => router.push("/")} className="text-white/30 hover:text-white transition-colors text-sm">
          ← Back
        </button>
        <div className="w-px h-4 bg-white/10" />
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base">📄</span>
          <span className="text-sm font-medium text-white/70 truncate">{docName}</span>
        </div>
        <button
          onClick={handleSummarize}
          disabled={isLoading}
          className="ml-auto flex items-center gap-2 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-40 border border-emerald-500/20 hover:border-emerald-500/40 text-emerald-400 text-xs font-mono px-4 py-2 rounded-lg transition-all"
        >
          {summarizing ? (
            <><div className="w-3 h-3 border border-emerald-400/40 border-t-emerald-400 rounded-full animate-spin" />Summarizing...</>
          ) : (
            <>✦ Summarize</>
          )}
        </button>
        <div className="flex items-center gap-2 ml-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-white/30 font-mono">Llama 3.3 70B</span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-2xl mx-auto flex flex-col gap-6">
          {messages.length === 0 && (
            <div className="text-center py-16">
              <div className="text-4xl mb-4">💬</div>
              <p className="text-white/40 text-sm mb-2">Ask anything about your document</p>
              <p className="text-white/20 text-xs mb-6">or click <span className="text-emerald-400/60">✦ Summarize</span> in the header</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {["What are the key points?", "What is the main conclusion?", "Explain the methodology"].map((q) => (
                  <button key={q} onClick={() => setInput(q)}
                    className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-full px-4 py-2 text-white/50 hover:text-white/80 transition-all">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "user" ? (
                <div className="bg-emerald-500/15 border border-emerald-500/20 rounded-2xl rounded-tr-sm px-5 py-3 max-w-md">
                  <p className="text-sm text-white/90">{msg.content}</p>
                </div>
              ) : (
                <div className="max-w-xl w-full">
                  {msg.isSummary && msg.content && (
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-mono text-emerald-400/60 bg-emerald-400/8 border border-emerald-400/15 px-3 py-1 rounded-full">
                        ✦ Document Summary
                      </span>
                    </div>
                  )}
                  <div className={`border rounded-2xl rounded-tl-sm px-5 py-4 ${msg.isSummary ? "bg-emerald-500/5 border-emerald-500/15" : "bg-white/3 border-white/8"}`}>
                    {msg.content ? (
                      <p className="text-sm text-white/80 leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                        {isLoading && i === messages.length - 1 && (
                          <span className="inline-block w-1.5 h-4 bg-emerald-400 ml-0.5 animate-pulse rounded-sm" />
                        )}
                      </p>
                    ) : (
                      <div className="flex gap-1.5 items-center py-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <div className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: "150ms" }} />
                        <div className="w-1.5 h-1.5 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    )}
                  </div>
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-2 flex flex-col gap-1.5">
                      <p className="text-xs text-white/20 font-mono px-1">Sources</p>
                      {msg.sources.map((src, j) => (
                        <div key={j} className="bg-white/2 border border-white/6 rounded-xl px-4 py-2.5">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono text-emerald-400/70">Page ~{src.page}</span>
                            <span className="text-xs text-white/15">·</span>
                            <span className="text-xs text-white/20">{src.score}% match</span>
                          </div>
                          <p className="text-xs text-white/35 leading-relaxed line-clamp-2">{src.excerpt}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-white/5 px-6 py-4 flex-shrink-0">
        <div className="max-w-2xl mx-auto flex gap-3">
          <div className="flex-1 bg-white/4 border border-white/10 rounded-xl overflow-hidden flex items-end">
            <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
              placeholder="Ask a question about your document..." rows={1}
              className="flex-1 bg-transparent px-4 py-3 text-sm text-white placeholder-white/20 outline-none resize-none max-h-32" />
          </div>
          <button onClick={sendMessage} disabled={!input.trim() || isLoading}
            className="bg-emerald-500 hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/20 text-black font-semibold text-sm px-5 rounded-xl transition-all flex-shrink-0">
            {loading ? "..." : "Send"}
          </button>
        </div>
        <p className="text-center text-xs text-white/15 mt-2">Enter to send · Shift+Enter for new line</p>
      </div>
    </main>
  );
}
