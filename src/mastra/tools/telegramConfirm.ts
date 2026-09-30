// src/mastra/tools/telegramConfirm.ts

import "dotenv/config";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is not set`);
  return value;
}

export const sendTelegramConfirmTool = createTool({
  id: "send-telegram-confirm",

  description:
    "Sends a follow-up Telegram message after a decision is acted on, so the reviewer knows the outcome (posted, rejected, or timed out).",

  inputSchema: z.object({
    title: z.string(),
    status: z.enum(["posted", "rejected", "skipped"]),
    postUrl: z.string().nullable(),
  }),

  outputSchema: z.object({ sent: z.boolean() }),

  execute: async ({ title, status, postUrl }) => {
    const botToken = requireEnv("TELEGRAM_BOT_TOKEN");
    const chatId = requireEnv("TELEGRAM_REVIEW_CHAT_ID");

    let message: string;
    if (status === "posted") {
      message = `✅ Posted: *${title}*\n${postUrl}`;
    } else if (status === "rejected") {
      message = `❌ Rejected: *${title}*`;
    } else {
      message = `⏱️ Timed out, skipped: *${title}*`;
    }

    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "Markdown",
        }),
      },
    );

    const data = await response.json();
    return { sent: Boolean(data.ok) };
  },
});
