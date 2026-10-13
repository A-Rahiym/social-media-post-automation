// src/mastra/tools/draftPosts.ts

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { postingAgent } from "../agents/postNews";

const articleSchema = z.object({
  id: z.number(),
  title: z.string(),
  summary: z.string().nullable(),
  quote: z.string().nullable(),
  url: z.string(),
  publishedAt: z.string().nullable(),
});

export const draftPostsTool = createTool({
  id: "draft-posts",

  description:
    "Drafts one concise Telegram channel post per article using postingAgent.",

  inputSchema: z.object({
    articles: z.array(articleSchema),
  }),

  outputSchema: z.object({
    drafts: z.array(
      z.object({
        articleId: z.number(),
        title: z.string(),
        url: z.string(),
        text: z.string(),
      }),
    ),
  }),

  execute: async ({ articles }) => {
    const drafts = [];

    for (const article of articles) {
      drafts.push({
        articleId: article.id,
        title: article.title,
        url: article.url,
        text: `${article.summary} \n ${article.url}`, // Fallback to title if summary is not provided
      });
    }

    return { drafts };
  },
});
