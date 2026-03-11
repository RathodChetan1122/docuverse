import { groq, LLM_MODEL } from "@/lib/groq";
import { buildQAUserMessage, QA_SYSTEM_PROMPT } from "@/lib/rag/prompts";
import { formatContext, retrieveRelevantChunks } from "@/lib/rag/retrieval";
import { redis } from "@/lib/redis";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { question, docId, sessionId } = await req.json();

    if (!question || !docId) {
      return NextResponse.json(
        { error: "question and docId are required" },
        { status: 400 }
      );
    }

    // ── 1. Retrieve relevant chunks from vector DB ────────────────────────
    // This is the "R" in RAG — find the top 5 most relevant text chunks
    // for the user's question using cosine similarity search.
    const chunks = await retrieveRelevantChunks(question, docId, 5);

    if (chunks.length === 0) {
      return NextResponse.json({
        answer: "I couldn't find relevant information in the document to answer your question.",
        sources: [],
      });
    }

    // ── 2. Format chunks into a context string ────────────────────────────
    const context = formatContext(chunks);

    // ── 3. Load chat history from Redis ──────────────────────────────────
    // We keep the last 6 messages (3 turns) so follow-up questions work.
    // More history = more tokens = slower + more expensive, so we cap it.
    const historyKey = `chat:${sessionId || "default"}:${docId}`;
    const rawHistory = await redis.lrange(historyKey, 0, 5);
    const chatHistory = rawHistory.reverse().join("\n");

    // ── 4. Build the final prompt ─────────────────────────────────────────
    const systemPrompt = QA_SYSTEM_PROMPT.replace("{context}", context);
    const userMessage = buildQAUserMessage(question, chatHistory);

    // ── 5. Call Groq LLM with streaming ──────────────────────────────────
    // We use streaming so the answer appears word-by-word in the UI
    // instead of waiting for the full response (much better UX).
    const stream = await groq.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      stream: true,
      temperature: 0.3,   // low temperature = more factual, less creative
      max_tokens: 1024,
    });

    // ── 6. Stream the response back to the client ─────────────────────────
    // We use a ReadableStream to pipe Groq's tokens directly to the browser.
    let fullAnswer = "";

    const readable = new ReadableStream({
      async start(controller) {
        // First, send the sources so the UI can show citations immediately
        const sourcesPayload = JSON.stringify({
          type: "sources",
          sources: chunks.map((c) => ({
            page: c.estimatedPage,
            excerpt: c.text.slice(0, 150) + "...",
            score: Math.round(c.score * 100),
          })),
        });
        controller.enqueue(new TextEncoder().encode(sourcesPayload + "\n"));

        // Then stream the actual answer tokens
        for await (const chunk of stream) {
          const token = chunk.choices[0]?.delta?.content || "";
          fullAnswer += token;
          if (token) {
            const tokenPayload = JSON.stringify({ type: "token", token });
            controller.enqueue(new TextEncoder().encode(tokenPayload + "\n"));
          }
        }

        controller.close();
      },
    });

    // ── 7. Save Q&A to Redis chat history ─────────────────────────────────
    // We save asynchronously (don't await) so it doesn't slow down the response.
    redis.lpush(historyKey, `Assistant: ${fullAnswer}`).catch(console.error);
    redis.lpush(historyKey, `User: ${question}`).catch(console.error);
    redis.ltrim(historyKey, 0, 11).catch(console.error); // keep last 12 entries

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
      },
    });

  } catch (error) {
    console.error("Chat error:", error);
    return NextResponse.json(
      { error: "Failed to generate answer. Please try again." },
      { status: 500 }
    );
  }
}