import { vectorIndex } from "../vector";

export interface RetrievedChunk {
  text: string;
  docId: string;
  chunkIndex: number;
  estimatedPage: number;
  score: number;
}

async function embedQuery(query: string): Promise<number[]> {
  const response = await fetch(
    "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: query, options: { wait_for_model: true } }),
    }
  );
  if (!response.ok) {
  const errText = await response.text();
  throw new Error(`HuggingFace embedding failed: ${response.status} ${response.statusText} — ${errText}`);
}
  const embedding = await response.json();
  if (Array.isArray(embedding[0])) return embedding[0] as number[];
  return embedding as number[];
}

export async function retrieveRelevantChunks(
  query: string,
  docId: string,
  topK: number = 5
): Promise<RetrievedChunk[]> {
  const queryVector = await embedQuery(query);
  const results = await vectorIndex.query(
    { vector: queryVector, topK, includeMetadata: true },
    { namespace: docId }
  );
  return results
    .filter((r) => r.score > 0.3)
    .map((r) => ({
      text: r.metadata?.text as string,
      docId: r.metadata?.docId as string,
      chunkIndex: r.metadata?.chunkIndex as number,
      estimatedPage: r.metadata?.estimatedPage as number,
      score: r.score,
    }));
}

export function formatContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((chunk, i) => `[Chunk ${i + 1} | Page ~${chunk.estimatedPage}]\n${chunk.text}`)
    .join("\n\n---\n\n");
}