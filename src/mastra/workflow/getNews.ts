import { createWorkflow, createStep } from "@mastra/core/workflows";

import { z } from "zod";
import { newsUrlList } from "../lib/newsLinks";
import { parseUrlWorkflow } from "./processSite";
import { parseTimeToSeconds } from "../lib/helper";

const getValidUrlsStep = createStep({
  id: "get-valid-urls",
  description:
    "Returns news websites whose configured minute matches the workflow start time.",

  inputSchema: z.object({
    urls: z.array(z.object({ url: z.url(), time: z.string() })).default(newsUrlList),
  }),

  outputSchema: z.url(),

  execute: async ({ inputData, bail }) => {
    const URLS = inputData.urls;
    const currentTime = parseTimeToSeconds(
      new Date().toTimeString().slice(0, 5),
    );

    const validRun = URLS.find(({ time }) => {
      const scheduledTime = parseTimeToSeconds(time);

      return scheduledTime >= currentTime;
    });

    if (!validRun) {
      return bail({
        status: "skipped",
        message: "No news URL is scheduled for the current time.",
        inserted: 0,
        updated: 0,
        total: 0,
      });
    }

    return validRun.url;
  },
});

const formatProcessedResultStep = createStep({
  id: "format-processed-result",
  description: "Adds the processed status and message to the extraction result.",
  inputSchema: z.object({
    inserted: z.number(),
    updated: z.number(),
    total: z.number(),
  }),
  outputSchema: z.object({
    status: z.literal("processed"),
    message: z.string(),
    inserted: z.number(),
    updated: z.number(),
    total: z.number(),
  }),
  execute: async ({ inputData }) => ({
    status: "processed" as const,
    message: "News articles processed successfully.",
    ...inputData,
  }),
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

  outputSchema: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("processed"),
      message: z.string(),
      inserted: z.number(),
      updated: z.number(),
      total: z.number(),
    }),
    z.object({
      status: z.literal("skipped"),
      message: z.string(),
      inserted: z.number(),
      updated: z.number(),
      total: z.number(),
    }),
  ]),
  schedule: {
    cron: "*/5 * * * *",
  },
})
  .then(getValidUrlsStep)
  .then(parseUrlWorkflow)
  .then(formatProcessedResultStep)
  .commit();
