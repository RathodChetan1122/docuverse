"use client";

import { useRouter } from "next/navigation";
import { use, useEffect, useRef, useState } from "react";

interface Source {
  page: number;
  excerpt: string;
  score: number;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
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
  const [docName, setDocName] = useState("Document");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load doc name from session storage
  useEffect(() => {
    const name = sessionStorage.getItem(`doc_name_${docId}`);
    if (name) setDocName(name);
  }, [docId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function sendMessage() {
    if (!input.trim() || loading) return;

    const question = input.trim();
    setInput("");
    setLoading(true);

    // Add user message immediately
    setMessages((prev) => [...prev, { role: "user", content: question }]);

    // Add empty assistant message that we'll stream into
    setMessages((prev) => [...prev, { role: "assistant", content: "", sources: [] }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          docId,
          sessionId: getSessionId(),
        }),
      });

      if (!res.ok) throw new Error("Chat request failed");

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let sources: Source[] = [];

      // Read the stream line by line
      // Each line is a JSON object with type "sources" or "token"
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);

            if (parsed.type === "sources") {
              sources = parsed.sources;
              // Update the last message with sources
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1].sources = sources;
                return updated;
              });
            } else if (parsed.type === "token") {
              // Append token to the last message
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1].content += parsed.token;
                return updated;
              });
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1].content =
          "Sorry, something went wrong. Please try again.";
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

  return (
    <main className="h-screen bg-[#080810] text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-white/5 px-6 py-4 flex items-center gap-4 flex-shrink-0">
        <button
          onClick={() => router.push("/")}
          className="text-white/30 hover:text-white transition-colors text-sm"
        >
          ← Back
        </button>
        <div className="w-px h-4 bg-white/10" />
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base">📄</span>
          <span className="text-sm font-medium text-white/70 truncate">{docName}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs text-white/30 font-mono">Llama 3.1 70B</span>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-2xl mx-auto flex flex-col gap-6">

          {/* Empty state */}
          {messages.length === 0 && (
            <div className="text-center py-16">
              <div className="text-4xl mb-4">💬</div>
              <p className="text-white/40 text-sm">Ask anything about your document</p>
              <div className="flex flex-wrap gap-2 justify-center mt-6">
                {["Summarize this document", "What are the key points?", "What is the main conclusion?"].map((q) => (
                  <button
                    key={q}
                    onClick={() => { setInput(q); }}
                    className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded-full px-4 py-2 text-white/50 hover:text-white/80 transition-all"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message list */}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              {msg.role === "user" ? (
                <div className="bg-emerald-500/15 border border-emerald-500/20 rounded-2xl rounded-tr-sm px-5 py-3 max-w-md">
                  <p className="text-sm text-white/90">{msg.content}</p>
                </div>
              ) : (
                <div className="max-w-xl w-full">
                  {/* Answer */}
                  <div className="bg-white/3 border border-white/8 rounded-2xl rounded-tl-sm px-5 py-4">
                    {msg.content ? (
                      <p className="text-sm text-white/80 leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                        {loading && i === messages.length - 1 && (
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

                  {/* Sources */}
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-2 flex flex-col gap-1.5">
                      <p className="text-xs text-white/20 font-mono px-1">Sources</p>
                      {msg.sources.map((src, j) => (
                        <div
                          key={j}
                          className="bg-white/2 border border-white/6 rounded-xl px-4 py-2.5"
                        >
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

      {/* Input */}
      <div className="border-t border-white/5 px-6 py-4 flex-shrink-0">
        <div className="max-w-2xl mx-auto flex gap-3">
          <div className="flex-1 bg-white/4 border border-white/10 rounded-xl overflow-hidden flex items-end">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question about your document..."
              rows={1}
              className="flex-1 bg-transparent px-4 py-3 text-sm text-white placeholder-white/20 outline-none resize-none max-h-32"
            />
          </div>
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className="bg-emerald-500 hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/20 text-black font-semibold text-sm px-5 rounded-xl transition-all flex-shrink-0"
          >
            {loading ? "..." : "Send"}
          </button>
        </div>
        <p className="text-center text-xs text-white/15 mt-2">Enter to send · Shift+Enter for new line</p>
      </div>
    </main>
  );
}