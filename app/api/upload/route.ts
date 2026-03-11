import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { processDocument } from "@/lib/rag/ingestion";
import { v4 as uuidv4 } from "uuid";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const sessionId = (formData.get("sessionId") as string) || "default";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!file.name.endsWith(".pdf")) {
      return NextResponse.json({ error: "Only PDF files are supported" }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "File too large. Max 10MB." }, { status: 400 });
    }

    const docId = uuidv4();
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { chunkCount } = await processDocument(docId, buffer);

    const docMeta = {
      docId,
      filename: file.name,
      uploadedAt: new Date().toISOString(),
      chunkCount,
      sessionId,
    };

    await redis.set(`doc:${docId}`, JSON.stringify(docMeta));
    await redis.lpush(`session:${sessionId}:docs`, docId);

    return NextResponse.json({
      success: true,
      docId,
      filename: file.name,
      chunkCount,
      message: `Document processed into ${chunkCount} chunks`,
    });

  } catch (error: unknown) {
    console.error("Upload error:", error);
    const message = error instanceof Error ? error.message : "Failed to process document";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
