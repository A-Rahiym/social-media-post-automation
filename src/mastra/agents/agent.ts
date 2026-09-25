import { pathToFileURL } from "node:url";
import { Agent } from "@mastra/core/agent";
import { TaskSignalProvider } from "@mastra/core/signals";
import { askUserTool, webFetchTool, webSearchTool } from "@mastra/core/tools";
import {
  LocalFilesystem,
  LocalSandbox,
  WORKSPACE_TOOLS,
  Workspace,
} from "@mastra/core/workspace";
import { Memory } from "@mastra/memory";
import { startScheduleTool, stopScheduleTool } from "../tools/schedule-tools";

const workspacePath = "workspace";

const workspace = new Workspace({
  id: "agent-workspace",
  name: "Agent Workspace",
  filesystem: new LocalFilesystem({
    basePath: workspacePath,
  }),
  sandbox: new LocalSandbox({
    workingDirectory: workspacePath,
  }),
  tools: {
    [WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]: {
      requireReadBeforeWrite: true,
    },
    [WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE]: {
      requireReadBeforeWrite: true,
    },
    [WORKSPACE_TOOLS.FILESYSTEM.DELETE]: {
      requireApproval: true,
    },
  },
});

export const testAgent = new Agent({
  id: "agent",
  name: "Agent",
  description:
    "A general-purpose assistant that can research, manage tasks, work with local files, run approved commands, and create recurring schedules.",
  metadata: {
    suggestedPrompts: [
      "What's the weather in Austin this weekend?",
      "What's the SPCX stock price right now?",
      "Build a Japanese sakura festival landing page.",
    ],
  },
  instructions: `
You are a web browsing agent.

The user will provide a news website URL.

Your job is to:

1. Open the provided website.
2. Navigate through the website to find the latest news articles.
3. Select the 5 most recent articles.
4. Open each article and read its contents.
5. Extract the article information directly from the webpage.
6. Do not summarize, interpret, rewrite, or analyze the articles.
7. Do not invent or infer information that is not present on the webpage.
8. Return the article header and the complete readable article body as they appear on the webpage.
9. Include the original URL for each article.
10. If an article cannot be accessed or read, skip it and continue to another recent article when possible.

Return up to 5 articles in this format:

{
"articles": [
{
"header": "Article headline/title",
"body": "Complete readable article body",
"url": "Original article URL"
}
]
}

Order the articles from newest to oldest.

The input URL is a website URL, not necessarily an article URL.

If the user does not provide a website URL, ask them to provide one.

`,
  model: "mistral/open-mistral-nemo",
  defaultOptions: {
    maxSteps: 100,
    autoResumeSuspendedTools: true,
  },
  memory: new Memory({
    options: {
      generateTitle: true,
    },
  }),
  workspace,
  tools: {
    ask_user: askUserTool,
    start_schedule: startScheduleTool,
    stop_schedule: stopScheduleTool,
  },
  signals: [new TaskSignalProvider()],
});
