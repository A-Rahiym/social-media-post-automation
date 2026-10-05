import "dotenv/config";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { requireEnv } from "../lib/env";



export const postToTelegramTool = createTool({
  id: "post-to-telegram",

  description: "Publishes one approved draft to the configured Telegram channel and returns its message ID.",

  inputSchema: z.object({
    text: z.string(),
  }),

  outputSchema: z.object({
    postId: z.string(),
  }),

  execute: async ({ text }) => {
    const botToken = requireEnv("TELEGRAM_BOT_TOKEN");
    const channelId = requireEnv("TELEGRAM_CHANNEL_ID");

    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: channelId,
          text,
        }),
      },
    );

    const data = await response.json();

    if (!data.ok) {
      throw new Error(`Telegram channel post failed: ${JSON.stringify(data)}`);
    }

    return { postId: String(data.result.message_id) };
  },
});