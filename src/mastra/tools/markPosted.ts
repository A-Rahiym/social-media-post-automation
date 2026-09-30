// src/mastra/tools/markPosted.ts

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

export const markPostedTool = createTool({
  id: "mark-posted",

  description:
    "Updates an article's row with its final posting status (posted, rejected, or skipped).",

  inputSchema: z.object({
    articleId: z.number(),
    status: z.enum(["posted", "rejected", "skipped"]),
    postDraft: z.string().nullable(),
    previewMessageId: z.string().nullable(),
    postId: z.string().nullable(),
  }),

  outputSchema: z.object({
    articleId: z.number(),
    status: z.string(),
  }),

  execute: async ({ articleId, status, postDraft, previewMessageId, postId }) => {
    const db = getPool();

    await db.query(
      `
      UPDATE articles
      SET status = $2,
          post_draft = $3,
          preview_message_id = $4,
          post_id = $5,
          posted_at = CASE WHEN $2 = 'posted' THEN now() ELSE posted_at END
      WHERE id = $1
      `,
      [articleId, status, postDraft, previewMessageId, postId],
    );

    return { articleId, status };
  },
});
