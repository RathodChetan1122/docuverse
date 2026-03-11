import { redis } from "@/lib/redis";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get("sessionId") || "default";
    const docIds = await redis.lrange(`session:${sessionId}:docs`, 0, -1);

    if (docIds.length === 0) {
      return NextResponse.json({ documents: [] });
    }

    const documents = await Promise.all(
      docIds.map(async (docId) => {
        const meta = await redis.get(`doc:${docId}`);
        if (!meta) return null;
        return typeof meta === "string" ? JSON.parse(meta) : meta;
      })
    );

    return NextResponse.json({ documents: documents.filter(Boolean) });
  } catch (error) {
    console.error("Documents fetch error:", error);
    return NextResponse.json({ documents: [] });
  }
}