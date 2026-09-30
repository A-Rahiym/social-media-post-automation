// src/mastra/tools/markPreviewed.ts

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

export const markPreviewedTool = createTool({
  id: "mark-previewed",

  description:
    "Marks an article as 'previewed' right after its Telegram card is sent, so a second workflow run cannot pick up the same article while it awaits a decision.",

  inputSchema: z.object({
    articleId: z.number(),
    previewMessageId: z.string(),
  }),

  outputSchema: z.object({ articleId: z.number() }),

  execute: async ({ articleId, previewMessageId }) => {
    const db = getPool();
    await db.query(
      `UPDATE articles SET status = 'previewed', preview_message_id = $2 WHERE id = $1`,
      [articleId, previewMessageId],
    );
    return { articleId };
  },
});
