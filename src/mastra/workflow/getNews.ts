// src/mastra/workflows/extraction-workflow.ts

import { createWorkflow, createStep } from "@mastra/core/workflows";

import { json, z } from "zod";
import { newsUrlList } from "../lib/newsLinks";
import { parseUrlWorkflow } from "./processSite";
import { parseTimeToSeconds } from "../lib/helper";
// import { getValidUrls } from "../tools/getValidurl";
import { mastra } from "..";

// const getValidUrlsStep = createStep(getValidUrls);

const getValidUrlsStep = createStep({
  id: "get-valid-urls",
  description:
    "Returns news websites whose configured minute matches the workflow start time.",

  inputSchema: z.object({
    urls: z.array(
      z.object({
        url: z.url(),
        time: z.string(),
      }),
    ),
    // .default(newsUrlList),
    workflowStartTime: z.date(),
  }),

  outputSchema: z.object({
    url: z.url(),
    time: z.string(),
  }),

  execute: async ({ inputData }) => {
    const URLS = inputData.urls;

    const validRun = URLS.find(({ time }) => {
      const scheduledTime = parseTimeToSeconds(time);
      const currentTime = parseTimeToSeconds(
        new Date(inputData.workflowStartTime).toTimeString().slice(0, 5),
      );

      return scheduledTime >= currentTime;
    });

    if (!validRun) {
      throw new Error("No configured news URL matches the current time");
    }

    return { url: validRun.url };
  },
});

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
    cron: "*/5 * * * *", /// Check configured website minutes every minute
  },
})
  .map(async ({ inputData }) => ({
    urls: inputData.urls,
    workflowStartTime: new Date(),
  }))
  .then(getValidUrlsStep)
  .then(parseUrlWorkflow)
  .commit();
