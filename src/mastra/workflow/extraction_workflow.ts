// src/mastra/workflows/extraction-workflow.ts

import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { webAgent } from "../agents/webAgent";
import { dataExtractionAgent } from "../agents/extractionAgent";
import { newsUrlList } from "../lib/newsLinks";
import { saveArticlesTool } from "../tools/saveArticle";
import { structuredOutputAgent } from "../agents/structuredOutputAgent";
import { articleSchema } from "../../schema/articleSchema";

const fetchingStep = createStep({
  id: "extraction-step",
  description: "Fetches news articles from a given website.",
  inputSchema: z.object({
     urls: z.array(z.url()).default(newsUrlList),
  }),
  outputSchema: z.object({
    response: z.string(),
  }),
  execute: async ({ inputData }) => {
    const urls = inputData.urls;


    const results = await Promise.allSettled(
      urls.map(async (url) => {
        const result = await webAgent.generate(
    `Process this website only: WEBSITE_URL: ${url}`,
        );
        return result.text;
      }),
    );

    
    const successfulResults = results
      .filter(
        (result): result is PromiseFulfilledResult<string> =>
          result.status === "fulfilled",
      )
      .map((result) => result.value);

    if (successfulResults.length === 0) {
      throw new Error("All website extraction attempts failed");
    }

    return {
      response: successfulResults.join("\n\n"),
    };
  },
});

// Step 2: Processing the fetched articles using the dataExtractionAgent to extract structured data.
const processingStep = createStep({
  id: "summarizing-step",
  inputSchema: z.object({
    response: z.string(),
  }),

  outputSchema: z.object({
    response: z.string(),
  }),

  execute: async ({ inputData }) => {
    const result = await dataExtractionAgent.generate([
      {
        role: "user",
        content: inputData.response,
      },
    ]);

    return {
      response: result.text,
    };
  },
});

// Step 3: Converting the processed data into a structured format using the structuredOutputAgent.
const structuredOutputStep = createStep({
  id: "structured-output-step",
  description: "Converts the processed data into a structured format.",
  inputSchema: z.object({
    response: z.string(),
  }),

  outputSchema: z.object({
    articles: z.array(articleSchema),
  }),

  execute: async ({ inputData }) => {
    const result = await structuredOutputAgent.generate(inputData.response, {
      structuredOutput: {
        schema: z.array(articleSchema),
      },
    });

    return {
      articles: result.object,
    };
  },
});

// step 4:
const saveStep = createStep(saveArticlesTool);


// step 5: Define the extraction workflow that chains the above steps together.
export const extractionWorkflow = createWorkflow({
  id: "Extraction-workflow",
  description:
    "This workflow is for extracting structured data from news articles. It fetches recent news articles from a given website and processes them to return structured data in JSON format. ",
    inputSchema: z.object({
     urls: z.array(z.url()).default(newsUrlList),
  }),

  outputSchema: z.object({
    articles: z.array(
      z.object({
        title: z.string(),
        summary: z.string(),
        quote: z.string().nullable(),
        url: z.string(),
        publishedAt: z.string().nullable(),
      }),
    ),
  }),
  schedule: {
    cron: "*/5 * * * *", /// Run every 5 minutes
  },
})
  .then(fetchingStep)
  .then(processingStep)
  .then(structuredOutputStep)
  .then(saveStep)
  .commit();
