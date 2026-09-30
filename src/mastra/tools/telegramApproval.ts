// src/mastra/tools/telegramApproval.ts
//
// Waits for the human review decision of one article.
//
// Decisions are written to Postgres by POST /webhooks/telegram (see
// src/mastra/server/telegramWebhook.ts) and read back here — no
// getUpdates polling. Polling must stay off while the webhook is active:
// multiple pollers compete for the same Telegram update stream and would
// steal each other's callbacks. The workflow's processArticleStep calls
// lib/reviewDecisions.awaitDecision() directly; this tool wraps the same
// function for Studio/manual use.

import "dotenv/config";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { awaitDecision } from "../lib/reviewDecisions";

export const awaitTelegramApprovalTool = createTool({
  id: "await-telegram-approval",

  description:
    "Waits for the Telegram review decision (approve/reject) on a given article, up to a timeout. Decisions arrive via the Telegram webhook.",

  inputSchema: z.object({
    articleId: z.number(),
    timeoutMinutes: z.number().default(60),
  }),

  outputSchema: z.object({
    decision: z.enum(["approved", "rejected", "timed_out"]),
  }),

  execute: async ({ articleId, timeoutMinutes }) => {
    const decision = await awaitDecision(articleId, timeoutMinutes);
    return { decision };
  },
});
