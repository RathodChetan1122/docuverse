"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

// We generate a session ID once per browser session so each user
// gets their own isolated document space in Redis.
function getSessionId(): string {
  if (typeof window === "undefined") return "default";
  let id = sessionStorage.getItem("docuverse_session");
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    sessionStorage.setItem("docuverse_session", id);
  }
  return id;
}

interface Document {
  docId: string;
  filename: string;
  uploadedAt: string;
  chunkCount: number;
}

export default function Dashboard() {
  const router = useRouter();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");

  // Load existing documents on mount
  const loadDocuments = useCallback(async () => {
    const sessionId = getSessionId();
   const res = await fetch(`/api/documents?sessionId=${sessionId}`);
const text = await res.text();
if (!text) return;
const data = JSON.parse(text);
if (data.documents) setDocuments(data.documents);
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  // Handle file upload
  async function handleUpload(file: File) {
    if (!file.name.endsWith(".pdf")) {
      setError("Only PDF files are supported.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("File too large. Max 10MB.");
      return;
    }

    setError("");
    setUploading(true);
    setUploadProgress("Reading PDF...");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("sessionId", getSessionId());

      setUploadProgress("Extracting text and creating embeddings...");

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Upload failed");

      setUploadProgress(`Done! Created ${data.chunkCount} chunks.`);

      // Wait 1s so user sees the success message, then navigate to chat
      setTimeout(() => {
        router.push(`/chat/${data.docId}`);
      }, 1000);

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setError(message);
      setUploading(false);
      setUploadProgress("");
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  }

  return (
    <main className="min-h-screen bg-[#080810] text-white">
      {/* Header */}
      <header className="border-b border-white/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 text-sm font-bold">
            D
          </div>
          <span className="font-semibold text-white tracking-tight">DocuVerse</span>
        </div>
        <span className="text-xs text-white/30 font-mono">RAG · Llama 3.1 · Groq</span>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-16">
        {/* Hero */}
        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-4 py-1.5 text-emerald-400 text-xs font-mono mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Powered by Llama 3.1 70B · Free
          </div>
          <h1 className="text-5xl font-bold tracking-tight mb-4 bg-gradient-to-br from-white to-white/50 bg-clip-text text-transparent">
            Chat with your<br />documents
          </h1>
          <p className="text-white/40 text-lg max-w-md mx-auto">
            Upload any PDF. Ask questions, get summaries, find answers — instantly.
          </p>
        </div>

        {/* Upload Zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`relative border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-200 mb-10 ${
            dragOver
              ? "border-emerald-400/60 bg-emerald-400/5"
              : "border-white/10 hover:border-white/20 bg-white/2"
          } ${uploading ? "pointer-events-none opacity-70" : "cursor-pointer"}`}
          onClick={() => !uploading && document.getElementById("fileInput")?.click()}
        >
          <input
            id="fileInput"
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={handleFileInput}
          />

          {uploading ? (
            <div className="flex flex-col items-center gap-4">
              {/* Spinner */}
              <div className="w-10 h-10 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
              <p className="text-white/60 text-sm">{uploadProgress}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-2xl mb-2">
                📄
              </div>
              <p className="text-white font-medium">Drop your PDF here</p>
              <p className="text-white/30 text-sm">or click to browse · Max 10MB</p>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm mb-8">
            {error}
          </div>
        )}

        {/* Document Library */}
        {documents.length > 0 && (
          <div>
            <h2 className="text-xs font-mono text-white/30 uppercase tracking-widest mb-4">
              Recent Documents
            </h2>
            <div className="flex flex-col gap-3">
              {documents.map((doc) => (
                <button
                  key={doc.docId}
                  onClick={() => router.push(`/chat/${doc.docId}`)}
                  className="w-full flex items-center justify-between bg-white/3 hover:bg-white/6 border border-white/8 hover:border-white/15 rounded-xl px-5 py-4 transition-all text-left group"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xl">📑</span>
                    <div>
                      <p className="text-sm font-medium text-white group-hover:text-emerald-300 transition-colors">
                        {doc.filename}
                      </p>
                      <p className="text-xs text-white/30 mt-0.5">
                        {doc.chunkCount} chunks · {new Date(doc.uploadedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <span className="text-white/20 group-hover:text-white/50 transition-colors text-lg">→</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}