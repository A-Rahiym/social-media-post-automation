// src/mastra/tools/getArticles.ts

import "dotenv/config";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { Pool } from "pg";

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

const outputArticleSchema = z.object({
  id: z.number(),
  title: z.string(),
  summary: z.string().nullable(),
  quote: z.string().nullable(),
  url: z.string(),
  publishedAt: z.string().nullable(),
});

export const getArticlesTool = createTool({
  id: "get-unposted-articles",

  description:
    "Fetches articles that have not yet been posted, oldest-fetch-first candidates for drafting.",

  inputSchema: z.object({
    limit: z.number().default(1),
  }),

  outputSchema: z.object({
    articles: z.array(outputArticleSchema),
  }),

  execute: async ({ limit }) => {
    const db = getPool();

    const result = await db.query(
      `
      SELECT id, title, summary, quote, url, published_at
      FROM articles
      WHERE posted_at IS NULL
        AND (status IS NULL OR status = 'fetched')
      ORDER BY published_at DESC NULLS LAST, id DESC
      LIMIT $1
      `,
      [limit],
    );

    const articles = result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      summary: row.summary,
      quote: row.quote,
      url: row.url,
      publishedAt: row.published_at ? String(row.published_at) : null,
    }));

    return { articles };
  },
});
