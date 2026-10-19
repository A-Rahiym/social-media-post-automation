import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { webAgent } from "../agents/getNews";
import { dataExtractionAgent } from "../agents/extractionNews";
import { structuredOutputAgent } from "../agents/structureResult";
import { saveArticlesTool } from "../tools/saveArticle";
import { articleSchema } from "../../schema/articleSchema";

const fetchUrlStep = createStep({
	id: "fetch-url",
	description: "Fetches recent article records from one news website URL.",
	inputSchema: z.url(),
	outputSchema: z.object({ response: z.string() }),
	execute: async ({ inputData }) => {
		const result = await webAgent.generate(
			`Process this website only: WEBSITE_URL: ${inputData}`,
		);

		return { response: result.text };
	},
});

const extractArticlesStep = createStep({
	id: "extract-articles",
	description: "Extracts independent article records from one website result.",
	inputSchema: z.object({ response: z.string() }),
	outputSchema: z.object({ response: z.string() }),
	execute: async ({ inputData }) => {
		const result = await dataExtractionAgent.generate([
			{ role: "user", content: inputData.response },
		]);

		return { response: result.text };
	},
});

const structureArticlesStep = createStep({
	id: "structure-articles",
	description: "Converts one website result into validated article records.",
	inputSchema: z.object({ response: z.string() }),
	outputSchema: z.object({ articles: z.array(articleSchema) }),
	execute: async ({ inputData }) => {
		const result = await structuredOutputAgent.generate(inputData.response, {
			structuredOutput: { schema: z.array(articleSchema) },
		});

		return { articles: result.object };
	},
});

const saveArticlesStep = createStep(saveArticlesTool);


export const parseUrlWorkflow = createWorkflow({
	id: "parse-url-workflow",
	description: "Fetches, structures, and saves articles from one news website URL.",
	inputSchema: z.url(),
	outputSchema: z.object({
		inserted: z.number(),
		updated: z.number(),
		total: z.number(),
	}),
})
	.then(fetchUrlStep)
	.then(extractArticlesStep)
	.then(structureArticlesStep)
	.then(saveArticlesStep)
	.commit();