// src/mastra/tools/telegramPreview.ts
//
// Sends a draft post to the review Telegram chat with Approve/Reject
// buttons for human review. Thin wrapper over lib/telegram.sendPreviewCard
// (the same function the posting workflow calls directly).

import "dotenv/config";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { sendPreviewCard } from "../lib/telegram";

export const sendTelegramPreviewTool = createTool({
  id: "send-telegram-preview",

  description:
    "Sends a draft post to the review Telegram chat with Approve/Reject buttons for human review.",

  inputSchema: z.object({
    articleId: z.number(),
    title: z.string(),
    url: z.string(),
    text: z.string(),
  }),

  outputSchema: z.object({
    previewMessageId: z.string(),
  }),

  execute: async ({ articleId, title, url, text }) => {
    const previewMessageId = await sendPreviewCard({
      articleId,
      title,
      url,
      text,
    });
    return { previewMessageId };
  },
});
