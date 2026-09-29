// src/mastra/tools/clean-json.ts

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { articleSchema } from "../../schema/articleSchema";

const newsSchema = z.object({
  articles: z.array(articleSchema),
});

export const cleanText = createTool({
  id: "clean-news-json",
  description:"Takes the raw JSON response from the news structuring agent, removes optional Markdown code fences, parses the JSON, and validates it against the expected news article schema. Returns validated news data ready for downstream processing or PostgreSQL storage.",
  inputSchema: z.object({
    response: z.string().describe("The raw response returned by the structure agent"),
  }),

  outputSchema: newsSchema,

  execute: async({response}) => {
  
  // Trim the text to removing trailing spaces
  let text = response.trim()
  
  // check the text to remove all markdown characters using regexp
  const fenced_text = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if( fenced_text) {
      text = fenced_text[1].trim();
    }
  // Transform text into Json
     const parsed = JSON.parse(text);

  //validate the structure using schema
    const result = newsSchema.safeParse(parsed);

    if (!result.success) 
    {
      throw new Error (
      `Invalid news data structure: ${result.error.message}`
      );
    }
    return result.data

  }
});