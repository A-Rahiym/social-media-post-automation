// src/mastra/tools/postToX.ts

import "dotenv/config";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { TwitterApi } from "twitter-api-v2";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is not set`);
  return value;
}

let client: TwitterApi | null = null;

function getClient(): TwitterApi {
  if (!client) {
    client = new TwitterApi({
      appKey: requireEnv("X_API_KEY"),
      appSecret: requireEnv("X_API_SECRET"),
      accessToken: requireEnv("X_ACCESS_TOKEN"),
      accessSecret: requireEnv("X_ACCESS_SECRET"),
    });
  }
  return client;
}

export const postToXTool = createTool({
  id: "post-to-x",

  description: "Posts an approved draft to X.",

  inputSchema: z.object({
    text: z.string(),
  }),

  outputSchema: z.object({
    postId: z.string(),
  }),

  execute: async ({ text }) => {
    const twitter = getClient();
    const result = await twitter.v2.tweet(text);
    return { postId: result.data.id };
  },
});
