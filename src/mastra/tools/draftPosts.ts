// src/mastra/tools/draftPosts.ts

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { postingAgent } from "../agents/postingAgent";

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

  description: "Drafts one X post per article using postingAgent.",

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
      const prompt = `
Title: ${article.title}
Summary: ${article.summary ?? "(none provided)"}
Quote: ${article.quote ?? "(none)"}
URL: ${article.url}
`;
      const response = await postingAgent.generate(prompt);

      drafts.push({
        articleId: article.id,
        title: article.title,
        url: article.url,
        text: response.text.trim(),
      });
    }

    return { drafts };
  },
});
