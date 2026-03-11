import { groq, LLM_MODEL } from "@/lib/groq";
import { SUMMARIZE_SYSTEM_PROMPT } from "@/lib/rag/prompts";
import { vectorIndex } from "@/lib/vector";
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { docId } = await req.json();

    if (!docId) {
      return NextResponse.json({ error: "docId is required" }, { status: 400 });
    }

    // ── 1. Fetch all chunks for this document from Upstash Vector ─────────
    // We query with a generic "summary" vector to get broad coverage
    // of the document's content rather than topic-specific chunks.
    const summaryQueryResponse = await fetch(
      "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: "main topics summary key points overview introduction conclusion",
          options: { wait_for_model: true },
        }),
      }
    );

    if (!summaryQueryResponse.ok) {
      throw new Error("Failed to generate summary embedding");
    }

    const embedding = await summaryQueryResponse.json();
    const vector = Array.isArray(embedding[0]) ? embedding[0] : embedding;

    // ── 2. Retrieve top 15 chunks for broad document coverage ─────────────
    const results = await vectorIndex.query(
      { vector, topK: 15, includeMetadata: true },
      { namespace: docId }
    );

    if (results.length === 0) {
      return NextResponse.json(
        { error: "No content found for this document" },
        { status: 404 }
      );
    }

    // ── 3. Build context from retrieved chunks ────────────────────────────
    const context = results
      .map((r, i) => `[Section ${i + 1}]\n${r.metadata?.text}`)
      .join("\n\n---\n\n");

    // ── 4. Call Groq LLM for summarization ────────────────────────────────
    const completion = await groq.chat.completions.create({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: SUMMARIZE_SYSTEM_PROMPT },
        { role: "user", content: `Please summarize this document:\n\n${context}` },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    });

    const summary = completion.choices[0]?.message?.content || "Could not generate summary.";

    return NextResponse.json({ summary });

  } catch (error) {
    console.error("Summarize error:", error);
    return NextResponse.json(
      { error: "Failed to generate summary" },
      { status: 500 }
    );
  }
}