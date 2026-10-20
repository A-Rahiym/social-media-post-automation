import { createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { embedTexts, hashText, pointIdFromUrl } from "../lib/embedding";
import { qdrant, COLLECTION, ensureCollection } from "../lib/qdrant";
import { getPool } from "../tools/saveArticle";

const savedArticle = z.object({
  id: z.number(),
  url: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  quote: z.string().nullable(),
  published_at: z.string().nullable(),
  status: z.string().nullable(),
  embedding_hash: z.string().nullable(),
});

const embeddedItem = z.object({
  article: savedArticle,
  vector: z.array(z.number()),
  contentHash: z.string(),
});

// ---------- Step A: hash the summary, embed only if new or changed ----------
export const embedArticlesStep = createStep({
  id: "embed-articles",
  inputSchema: z.object({
    articles: z.array(savedArticle),
    inserted: z.number(),
    updated: z.number(),
    total: z.number(),
  }),
  outputSchema: z.object({
    items: z.array(embeddedItem),
    inserted: z.number(),
    updated: z.number(),
    total: z.number(),
  }),
  execute: async ({ inputData }) => {
    const todo = inputData.articles
      .filter((a) => a.summary)
      .map((article) => ({
        article,
        contentHash: hashText(article.summary!),
      }))
      // skip if this exact summary was already embedded
      .filter((x) => x.contentHash !== x.article.embedding_hash);

    const counts = {
      inserted: inputData.inserted,
      updated: inputData.updated,
      total: inputData.total,
    };

    if (todo.length === 0) return { items: [], ...counts };

    // one batched call, summary text only
    const vectors = await embedTexts(todo.map((x) => x.article.summary!));

    return {
      items: todo.map((x, i) => ({
        article: x.article,
        vector: vectors[i],
        contentHash: x.contentHash,
      })),
      ...counts,
    };
  },
});

// ---------- Step B: store ----------
export const storeEmbeddingsStep = createStep({
  id: "store-embeddings",
  inputSchema: z.object({
    items: z.array(embeddedItem),
    inserted: z.number(),
    updated: z.number(),
    total: z.number(),
  }),
  outputSchema: z.object({
    stored: z.number(),
    inserted: z.number(),
    updated: z.number(),
    total: z.number(),
  }),
  execute: async ({ inputData }) => {
    const counts = {
      inserted: inputData.inserted,
      updated: inputData.updated,
      total: inputData.total,
    };

    if (inputData.items.length === 0) return { stored: 0, ...counts };

    await ensureCollection();

    await qdrant.upsert({
      indexName: COLLECTION,
      ids: inputData.items.map((i) => pointIdFromUrl(i.article.url)),
      vectors: inputData.items.map((i) => i.vector),
      metadata: inputData.items.map(({ article, contentHash }) => ({
        article_id: article.id,
        url: article.url,
        title: article.title,
        summary: article.summary,
        quote: article.quote,
        source: new URL(article.url).hostname,
        published_at: article.published_at,
        published_at_epoch: article.published_at
          ? Math.floor(new Date(article.published_at).getTime() / 1000)
          : null,
        status: article.status,
        embedding_model: process.env.EMBEDDING_MODEL,
        content_hash: contentHash,
        embedded_at: new Date().toISOString(),
      })),
    });

    // Only after Qdrant succeeds, record the hash in Postgres
    const db = getPool();
    for (const { article, contentHash } of inputData.items) {
      await db.query(
        "UPDATE articles SET embedding_hash = $1, embedded_at = now() WHERE id = $2",
        [contentHash, article.id],
      );
    }

    return { stored: inputData.items.length, ...counts };
  },
});
