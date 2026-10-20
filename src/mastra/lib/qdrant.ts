import { QdrantVector } from "@mastra/qdrant";

export const COLLECTION = process.env.QDRANT_COLLECTION ?? "news_articles_v1";

export const qdrant = new QdrantVector({
  id: "qdrant",
  url: process.env.QDRANT_URL ?? "http://localhost:6333",
  apiKey: process.env.QDRANT_API_KEY || undefined,
});

let ready = false;
export async function ensureCollection() {
  if (ready) return;

  const raw = process.env.EMBEDDING_DIMENSIONS;
  const dimension = raw === undefined || raw === "" ? 384 : Number(raw);
  if (!Number.isInteger(dimension) || dimension <= 0) {
    throw new Error(
      `EMBEDDING_DIMENSIONS must be a positive integer, got "${raw}"`,
    );
  }

  const existing = await qdrant.listIndexes();
  if (!existing.includes(COLLECTION)) {
    await qdrant.createIndex({
      indexName: COLLECTION,
      dimension,
      metric: "cosine",
    });
  }
  ready = true;
}
