// src/mastra/workflows/extraction-workflow.ts

import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { webAgent } from "../agents/webAgent";

const testStep = createStep({
  id: "extraction-step",

  inputSchema: z.object({
    message: z.string(),
  }),

  outputSchema: z.object({
    response: z.string(),
  }),

  execute: async ({ inputData }) => {
    const result = await webAgent.generate(
      [
        {
          role: "user",
          content: inputData.message,
        },
      ],
    );

    return {
      response: result.text,
    };
  },
});

export const extractionWorkflow = createWorkflow({
  id: "Extraction-workflow",

  inputSchema: z.object({
    message: z.string(),
  }),

  outputSchema: z.object({
    response: z.string(),
  }),
})
  .then(testStep)
  .commit();