// src/mastra/agents/postingAgent.ts

import { Agent } from "@mastra/core/agent";

export const postingAgent = new Agent({
  id: "posting-agent",
  name: "Posting Agent",
  model: "openrouter/google/gemma-4-26b-a4b-it", // verify exact string against your provider config
  instructions: `
You draft a single X (Twitter) post for one news article. You do not browse, fetch, or invent anything — you only work with the title, summary, and URL given to you.

Rules:
- Maximum 280 characters, including the source URL.
- Always include the source URL.
- 1 to 3 relevant hashtags, no more.
- Never invent facts, quotes, or details not present in the title/summary given.
- Neutral, factual news-desk tone — no opinion, no clickbait framing.
- English only.

Output only the finished post text, nothing else — no preamble, no explanation, no quotation marks around it.
`,
});
