// src/mastra/tools/telegramApproval.ts
//
// NOTE: this uses polling (getUpdates) rather than a webhook + workflow
// suspend/resume. Simpler to run with no extra HTTP infrastructure, at the
// cost of holding this step open for the whole review window. Fine for a
// small, low-volume setup — revisit if you ever run many articles in
// parallel or want the process free to restart mid-review.

import "dotenv/config";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is not set`);
  return value;
}

const POLL_INTERVAL_MS = 5_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const awaitTelegramApprovalTool = createTool({
  id: "await-telegram-approval",

  description:
    "Polls Telegram for Approve/Reject button presses for a batch of articles, up to a timeout.",

  inputSchema: z.object({
    articleIds: z.array(z.number()).min(1),
    timeoutMinutes: z.number().default(60),
  }),

  outputSchema: z.object({
    decisions: z.array(
      z.object({
        articleId: z.number(),
        decision: z.enum(["approved", "rejected", "timed_out"]),
      }),
    ),
  }),

  execute: async ({ articleIds, timeoutMinutes }) => {
    const botToken = requireEnv("TELEGRAM_BOT_TOKEN");
    const allowedChatId = requireEnv("TELEGRAM_REVIEW_CHAT_ID");
    const pendingArticleIds = new Set(articleIds);
    const decisions = new Map<number, "approved" | "rejected">();

    const deadline = Date.now() + timeoutMinutes * 60_000;
    let offset = 0;

    while (Date.now() < deadline) {
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/getUpdates?offset=${offset}&timeout=0`,
      );
      const data = await response.json();
      console.log("Telegram getUpdates response:", data);
      if (data.ok) {
        for (const update of data.result) {
          offset = update.update_id + 1;

          const callback = update.callback_query;
          if (!callback?.data) continue;

          const fromChatId = String(callback.message?.chat?.id ?? "");
          if (fromChatId !== String(allowedChatId)) continue; // ignore non-allow-listed chats

          const [action, idStr] = callback.data.split(":");
          const articleId = Number(idStr);
          if (!pendingArticleIds.has(articleId) || decisions.has(articleId)) continue;

          if (action === "approve") decisions.set(articleId, "approved");
          if (action === "reject") decisions.set(articleId, "rejected");
        }

        if (decisions.size === pendingArticleIds.size) {
          return {
            decisions: articleIds.map((articleId) => ({
              articleId,
              decision: decisions.get(articleId)!,
            })),
          };
        }
      }

      await sleep(POLL_INTERVAL_MS);
    }

    return {
      decisions: articleIds.map((articleId) => ({
        articleId,
        decision: decisions.get(articleId) ?? "timed_out" as const,
      })),
    };
  },
});
