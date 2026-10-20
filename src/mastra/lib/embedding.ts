import { createHash } from "node:crypto";
import { embedMany } from "ai";
import { fastembed } from "@mastra/fastembed";
import { v5 as uuidv5 } from "uuid";

// Fixed namespace so the same URL always gives the same ID
const NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8"; // standard URL namespace

// Local model (bge-small-en-v1.5, 384 dimensions). No API key required.
export const embedder = fastembed.smallV2;

export function hashText(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

export function pointIdFromUrl(url: string) {
  return uuidv5(url, NAMESPACE); // Qdrant IDs must be UUID or integer
}

export async function embedTexts(texts: string[]) {
  const { embeddings } = await embedMany({ model: embedder, values: texts });
  return embeddings;
}
