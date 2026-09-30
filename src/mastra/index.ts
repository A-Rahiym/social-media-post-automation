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

export const mastra = new Mastra({
  bundler: {
    externals: ['@duckdb/node-bindings'],
  },
  agents: { extractionAgent: dataExtractionAgent,
    webAgent: webAgent,
    structuredOutputAgent: structuredOutputAgent
   },
  workflows: { extractionWorkflow, postNewsWorkflow
    
  },
  tools: { startScheduleTool, stopScheduleTool },
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