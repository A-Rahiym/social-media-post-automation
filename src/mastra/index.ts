import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { DuckDBStore } from '@mastra/duckdb';
import { MastraCompositeStore } from '@mastra/core/storage';
import {extractionWorkflow} from './workflow/extractNews';
import {postNewsWorkflow} from './workflow/postNews';
import {webAgent} from './agents/web';

import {
  MastraStorageExporter,
  MastraPlatformExporter,
  Observability,
  SensitiveDataFilter,
} from '@mastra/observability';
import { dataExtractionAgent } from './agents/extraction';
import { startScheduleTool, stopScheduleTool } from './tools/schedule-tools';
import { structuredOutputAgent } from './agents/structuredOutput';
import { postingAgent } from './agents/postingAgent';
import { getArticlesTool } from './tools/getArticles';
import { draftPostsTool } from './tools/draftPosts';
import { sendTelegramPreviewTool } from './tools/telegramPreview';
import { awaitTelegramApprovalTool } from './tools/telegramApproval';
import { postToXTool } from './tools/postToX';
import { markPostedTool } from './tools/markPosted';
import { telegramWebhookRoute } from './server/telegramWebhook';

export const mastra = new Mastra({
  bundler: {
    externals: ['@duckdb/node-bindings'],
  },
  agents: { extractionAgent: dataExtractionAgent,
    webAgent: webAgent,
    structuredOutputAgent: structuredOutputAgent,
    postingAgent: postingAgent
   },
  workflows: { extractionWorkflow, postNewsWorkflow

  },
  tools: {
    startScheduleTool, stopScheduleTool,
    getArticlesTool, draftPostsTool,
    sendTelegramPreviewTool, awaitTelegramApprovalTool,
    postToXTool, markPostedTool,
  },
  server: {
    apiRoutes: [telegramWebhookRoute],
  },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: 'mastra-storage',
      url: process.env.TURSO_DATABASE_URL || 'file:./mastra.db',
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    }),
    domains: {
      observability: await new DuckDBStore().getStore('observability'),
    },
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [new MastraStorageExporter(), new MastraPlatformExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
});