// src/mastra/tools/postToX.ts
//
// Posts an approved draft to X. Thin wrapper over lib/posting.postToX
// (the same function the posting workflow calls directly).

import "dotenv/config";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { postToX } from "../lib/posting";

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
    const postId = await postToX(text);
    return { postId };
  },
});
