import { z } from "zod";

export const articleSchema = z.object({
  title: z.string(),
  summary: z.string().nullable(),
  quote: z.string().nullable(),
  url: z.string(),
  publishedAt: z.string().nullable(),
});
