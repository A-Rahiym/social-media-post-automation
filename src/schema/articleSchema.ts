import { z } from "zod";

export const articleSchema = z.object({
  title: z.string(),
  summary: z.string().nullable(),
  quote: z.string().nullable(),
  url: z.string(),
  publishedAt: z.string().nullable(),
});


export const postArticleSchema = z.object({
    articleId: z.number(),
    title: z.string(),
    text: z.string(),
    previewMessageId: z.string(),
    status: z.enum(["posted", "rejected", "skipped"]),
    postId: z.string().nullable(),
  });