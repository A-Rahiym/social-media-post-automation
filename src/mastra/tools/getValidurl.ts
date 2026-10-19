import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { newsUrlList } from "../lib/newsLinks";
import { parseTimeToSeconds } from "../lib/helper";

export const getValidUrls = createTool({
  id: "get-valid-urls",
  description:
    "Returns news websites whose configured hour and minute match the workflow start time.",

  inputSchema: z.object({
    urls: z
      .array(
        z.object({
          url: z.url(),
          time: z.string(),
        }),
      )
      .default(newsUrlList),
    workflowStartTime: z.date(),
  }),

  outputSchema: z.object({
    url: z.url(),
  }),

  execute: async ({ urls, workflowStartTime }) => {
 const URLS = urls;    
    const validruns = URLS.find(({ time }) => {
      const scheduledTime = parseTimeToSeconds(time);
      const w_Time = new Date(workflowStartTime).toTimeString().slice(0, 5);
      const currentTime = parseTimeToSeconds(w_Time);
      return (
        scheduledTime >= currentTime 
      );
    });
    return validruns
  },
    })
