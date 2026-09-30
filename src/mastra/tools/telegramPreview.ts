// src/mastra/tools/telegramPreview.ts

import "dotenv/config";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is not set`);
  return value;
}

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
    const botToken = requireEnv("TELEGRAM_BOT_TOKEN");
    const chatId = requireEnv("TELEGRAM_REVIEW_CHAT_ID");

    const card = `📰 *${title}*\n\n${text}\n\n🔗 ${url}`;

    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: card,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "Approve ✅", callback_data: `approve:${articleId}` },
                { text: "Reject ❌", callback_data: `reject:${articleId}` },
              ],
            ],
          },
        }),
      },
    );

    const data = await response.json();

    if (!data.ok) {
      throw new Error(`Telegram sendMessage failed: ${JSON.stringify(data)}`);
    }

    return { previewMessageId: String(data.result.message_id) };
  },
});
