import "dotenv/config";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { Pool } from "pg";
import { articleSchema } from "../../schema/articleSchema";

const inputSchema = z.object({
  articles: z.array(articleSchema),
});

const savedArticleSchema = z.object({
  id: z.number(),
  url: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  quote: z.string().nullable(),
  published_at: z.string().nullable(),
  status: z.string().nullable(),
  embedding_hash: z.string().nullable(),
});

const outputSchema = z.object({
  inserted: z.number(),
  updated: z.number(),
  total: z.number(),
  articles: z.array(savedArticleSchema),
});

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL environment variable is not set. Add it to your .env file, e.g. DATABASE_URL=postgresql://user:password@localhost:5432/mydatabase",
      );
    }
    pool = new Pool({ connectionString });
  }

  return pool;
}

export const saveArticlesTool = createTool({
  id: "save-articles",
  description:
    "Saves structured, validated news article records into the Postgres 'articles' table. Upserts on URL, so re-running the same article does not create a duplicate row  it updates the existing one instead.",
  inputSchema,
  outputSchema,

  execute: async ({ articles }) => {
    if (articles.length === 0) {
      return {
        inserted: 0,
        updated: 0,
        total: 0,
        articles: [],
      };
    }
    const db = getPool();
    const client = await db.connect();
    let inserted: number = 0;
    let updated = 0;
    const saved: z.infer<typeof savedArticleSchema>[] = [];

    try {
      await client.query("BEGIN");
      for (const article of articles) {
        const result = await client.query(
          `INSERT INTO articles (title, summary, quote, url, published_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (url) DO UPDATE SET
      title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      quote = EXCLUDED.quote,
      published_at = EXCLUDED.published_at
      RETURNING (xmax = 0) AS inserted,
        id, url, title, summary, quote, published_at, status, embedding_hash
         `,
          [
            article.title,
            article.summary,
            article.quote,
            article.url,
            article.publishedAt,
          ],
        );

        const row = result.rows[0];
        if (row?.inserted) {
          inserted += 1;
        } else {
          updated += 1;
        }

        if (row) {
          saved.push({
            id: Number(row.id),
            url: row.url,
            title: row.title,
            summary: row.summary,
            quote: row.quote,
            published_at: row.published_at
              ? new Date(row.published_at).toISOString()
              : null,
            status: row.status,
            embedding_hash: row.embedding_hash,
          });
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");

      throw new Error(
        `Failed to save articles: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      client.release();
    }

    return { inserted, updated, total: articles.length, articles: saved };
  },
});
