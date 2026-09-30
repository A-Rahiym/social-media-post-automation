// src/mastra/tools/markPosted.ts
//
// Updates an article's row with its final posting status (posted,
// rejected, skipped, or failed). Thin wrapper over
// lib/posting.recordArticleOutcome (the same function the posting
// workflow calls directly). "failed" means X posting errored — the
// article stays re-selectable so a later run can retry it.

import "dotenv/config";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { recordArticleOutcome } from "../lib/posting";

export const markPostedTool = createTool({
  id: "mark-posted",

  description:
    "Updates an article's row with its final posting status (posted, rejected, skipped, or failed).",

  inputSchema: z.object({
    articleId: z.number(),
    status: z.enum(["posted", "rejected", "skipped", "failed"]),
    postDraft: z.string().nullable(),
    previewMessageId: z.string().nullable(),
    postId: z.string().nullable(),
  }),

  outputSchema: z.object({
    articleId: z.number(),
    status: z.string(),
  }),

  execute: async ({ articleId, status, postDraft, previewMessageId, postId }) => {
    return recordArticleOutcome({
      articleId,
      status,
      postDraft,
      previewMessageId,
      postId,
    });
  },
});
