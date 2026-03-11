import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { vectorIndex } from "../vector";

// Using direct path import bypasses pdf-parse's internal test file check
// which causes ENOENT errors in production (Vercel) environments
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);

  // Clean duplicated words/characters from pdf-parse output
  const cleaned = data.text
    .split("\n")
    .map((line: string) =>
      line
        .split(/\s+/)
        .map((word: string) => {
          if (word.length >= 6) {
            const half = Math.ceil(word.length / 2);
            if (word.slice(0, half) === word.slice(half)) {
              return word.slice(0, half);
            }
          }
          return word;
        })
        .join(" ")
    )
    .join("\n")
    .replace(/\b(\w+)( \1\b)+/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned;
}

export async function chunkText(text: string): Promise<string[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 50,
    separators: ["\n\n", "\n", " ", ""],
  });
  const docs = await splitter.createDocuments([text]);
  return docs.map((doc) => doc.pageContent);
}

async function embedText(text: string): Promise<number[]> {
  const response = await fetch(
    "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: text,
        options: { wait_for_model: true },
      }),
    }
  );
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `HuggingFace embedding failed: ${response.status} — ${errText}`
    );
  }
  const embedding = await response.json();
  if (Array.isArray(embedding[0])) return embedding[0] as number[];
  return embedding as number[];
}

export async function ingestDocument(
  docId: string,
  chunks: string[]
): Promise<void> {
  const batchSize = 10;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const vectors = await Promise.all(
      batch.map(async (chunk, batchIndex) => {
        const chunkIndex = i + batchIndex;
        const vector = await embedText(chunk);
        return {
          id: `${docId}_chunk_${chunkIndex}`,
          vector,
          metadata: {
            docId,
            chunkIndex,
            text: chunk,
            estimatedPage: Math.floor(chunkIndex / 3) + 1,
          },
        };
      })
    );
    await vectorIndex.upsert(vectors, { namespace: docId });
  }
}

export async function processDocument(
  docId: string,
  pdfBuffer: Buffer
): Promise<{ chunkCount: number }> {
  const text = await extractTextFromPDF(pdfBuffer);
  const chunks = await chunkText(text);
  await ingestDocument(docId, chunks);
  return { chunkCount: chunks.length };
}