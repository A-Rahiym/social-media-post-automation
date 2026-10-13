import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const getValidUrls = createTool({
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
    workflowStartTime: z.string(),
  }),

  outputSchema: z.array(
    z.object({
      url: z.url(),
    }),
  ),

  execute: async (inputData) => {
    const workflowStartTime = new Date(inputData.workflowStartTime);

    const validUrls = inputData.urls.filter(({ time }) => {
      const scheduledMinute = Number(time);

      // Process a website when its configured minute matches the current local minute.
      return workflowStartTime.getMinutes() === scheduledMinute;
    });

    return validUrls.map(({ url }) => ({ url }));
  },
});