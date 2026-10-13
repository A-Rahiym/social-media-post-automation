// src/mastra/workflows/extraction-workflow.ts

import { createWorkflow, createStep } from "@mastra/core/workflows";

import { z } from "zod";
import { newsUrlList } from "../lib/newsLinks";
import { parseUrlWorkflow } from "./processSite";
import { getValidUrls } from "../tools/getValidurl";

const getValidUrlsStep = createStep(getValidUrls);

// step 5: Define the extraction workflow that chains the above steps together.
export const extractionWorkflow = createWorkflow({
  id: "extractionWorkflow",
  description:
    "Fetches, structures, and saves each configured news website one at a time.",
  inputSchema: z.object({
    urls: z
      .array(
        z.object({
          url: z.url(),
          time: z.string(),
        }),
      )
      .default(newsUrlList),
  }),

  outputSchema: z.array(
    z.object({
      inserted: z.number(),
      updated: z.number(),
      total: z.number(),
    }),
  ),
  schedule: {
    cron: "* * * * *", /// Check configured website minutes every minute
  },
})
  .map(async ({ inputData }) => ({
    urls: inputData.urls,
    workflowStartTime: new Date().toISOString(),
  }))
  .then(getValidUrlsStep)
  .foreach(parseUrlWorkflow)
  .commit();