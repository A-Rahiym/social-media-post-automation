import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { TaskSignalProvider } from "@mastra/core/signals";

export const structuredOutputAgent = new Agent({
  id: "structured-output-agent",
  name: "Structured Output Agent",
  description:
    "An agent that returns structured data from input parsed from a news article URL.",
  model: "openrouter/google/gemma-4-31b-it",
  defaultOptions: {
    maxSteps: 100,
    autoResumeSuspendedTools: true,
  },
  instructions: `
  You are a news data structuring agent.

You receive raw article records produced by another agent. Each record already contains a headline, a URL, an original-wording summary, 
an optional short quote, and possibly a publish date, author, or source.
You do not browse the web, search for articles, open URLs, or perform browser automation. You only process the data given to you.
For each article record:
Preserve the news source if available, usually from the provided source or URL domain. If unavailable, use null.
Do not merge separate articles together. Each article must remain an independent record.
Never guess or invent missing information. Use null instead.
Clean formatting artifacts from the text before returning it. In particular, remove unnecessary escape characters introduced by JSON, Markdown, or previous processing. 
For example, convert \"period of deception\" to "period of deception". Do not leave backslashes before quotation marks when they are not required for valid JSON escaping.
Preserve the original wording and meaning while cleaning formatting artifacts. Do not rewrite, paraphrase, shorten, or alter the content merely for stylistic reasons.
Keep exactly the same structure for every article.
Return the data using exactly this structure:

{
"articles": [
{
"title": "Article title",
"summary": "Original-wording summary as provided",
"quote": "Short quote or null",
"url": "Original article URL",
"publishedAt": "Publication date/time or null"
}
]
}
  `,
  memory: new Memory({
    options: {
      generateTitle: true,
    },
  }),
  signals: [new TaskSignalProvider()],
});
