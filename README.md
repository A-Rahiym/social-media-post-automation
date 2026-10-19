# social-media-post-automation

Scheduled news ingestion and Telegram publishing built on [Mastra](https://mastra.ai). A headless browser agent finds the latest articles on Nigerian news sites, the pipeline structures and stores them in Postgres, and a review workflow drafts a post, sends it to a Telegram review chat, and publishes approved drafts to a Telegram channel.

## Pipeline

```
extractionWorkflow (every 5 minutes)
  └─ pick the next due source from newsUrlList
       └─ parseUrlWorkflow
            fetch (headless browser agent)
            → extract (LLM)
            → structure (validated JSON)
            → save to Postgres (upsert on url)

postNewsWorkflow (run from Mastra Studio or on demand)
  load unposted articles
  → draft post text
  → foreach: Telegram preview → approval → publish/skip → record → confirm
```

A scheduled run with no due source returns `status: "skipped"` instead of failing. Successful runs return `status: "processed"` with inserted/updated/total counts.

## Requirements

- Node.js >= 22.13.0
- Docker (for the local Postgres container)
- An [OpenRouter](https://openrouter.ai) API key
- A Telegram bot with access to a review chat and a publication channel

## Setup

1. Install dependencies:

   ```shell
   npm install
   ```

2. Start Postgres:

   ```shell
   docker compose up -d
   ```

   The compose file exposes Postgres 16 on host port **5632** (container port 5432) with user `user`, password `password`, and database `mydatabase`.

3. Create the `articles` table. There is no migration runner in this repo, so apply it once:

   ```sql
   CREATE TABLE IF NOT EXISTS articles (
     id BIGSERIAL PRIMARY KEY,
     title TEXT NOT NULL,
     summary TEXT,
     quote TEXT,
     url TEXT NOT NULL UNIQUE,
     published_at TIMESTAMPTZ,
     status TEXT,
     post_draft TEXT,
     preview_message_id TEXT,
     post_id TEXT,
     posted_at TIMESTAMPTZ
   );
   ```

4. Create `.env` from the template and fill it in:

   ```dotenv
   OPENROUTER_API_KEY=
   DATABASE_URL=postgresql://user:password@localhost:5632/mydatabase

   TELEGRAM_BOT_TOKEN=
   TELEGRAM_REVIEW_CHAT_ID=
   TELEGRAM_CHANNEL_ID=
   TELEGRAM_CHANNEL_USERNAME=
   ```

5. Start Mastra Studio:

   ```shell
   npm run dev
   ```

   Open [http://localhost:4111](http://localhost:4111). The workflows appear as `extractionWorkflow`, `parse-url-workflow`, and `post-news-workflow`.

## Configuration

| What | Where |
|---|---|
| News sources and run times | `src/mastra/lib/newsLinks.ts` (`newsUrlList`, `time` is `HH:MM`) |
| Extraction cron | `src/mastra/workflow/getNews.ts` (`*/5 * * * *`) |
| Browser behavior | `src/browser/agentBrowser.ts` (headless) |
| Models | `src/mastra/agents/*.ts` (OpenRouter `gemma-4-31b-it` / `gemma-4-26b-a4b-it`) |
| Review timeout | `src/mastra/tools/telegramApproval.ts` (60 minutes, polls `getUpdates`) |
| Draft length/content | `src/mastra/agents/postNews.ts` and `src/mastra/tools/draftPosts.ts` |

`extractionWorkflow` selects the first source whose scheduled minute is at or after the current time. Later runs with no remaining source skip the run. Register any new agent, tool, workflow, or scorer in `src/mastra/index.ts` so Mastra can load it.

## Telegram setup

1. Create a bot with [BotFather](https://t.me/BotFather).
2. Add the bot as an administrator of the publication channel with permission to post messages.
3. Set `TELEGRAM_CHANNEL_ID` to the channel's numeric ID and `TELEGRAM_CHANNEL_USERNAME` to the public username without `@` (used to build confirmation links).
4. Set `TELEGRAM_REVIEW_CHAT_ID` to a chat separate from the publication channel.

Published flow:

- `postNewsWorkflow` loads unposted articles (`limit` defaults to 1), drafts text as `summary + url`, and marks each article `previewed` before waiting for a decision.
- Approve publishes to the channel and marks the article `posted`; Reject and timeout publish nothing and mark it `rejected` or `skipped`.
- The approval step holds the workflow open while it long-polls Telegram. Run one instance for a small, low-volume setup; restarting mid-review drops the pending wait.

Article statuses: `fetched` (or `NULL`), `previewed`, `posted`, `rejected`, `skipped`. Only `posted` sets `posted_at`, and only articles with `posted_at IS NULL` and status `fetched`/`NULL` are drafted again.

## Storage

| Data | Store |
|---|---|
| Articles and publication state | Postgres (`DATABASE_URL`) |
| Memory, tasks, schedules | LibSQL at `file:./mastra.db`, or Turso when `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` are set |
| Observability traces | DuckDB under `src/mastra/public/` |

`src/mastra/public/`, `*.db`, `*.duckdb`, `.mastra/`, `node_modules/`, and `.env` are git-ignored. Do not commit tokens, chat IDs, or local database files.

## Project layout

```
src/
├── browser/agentBrowser.ts        headless AgentBrowser instance
├── schema/articleSchema.ts        shared zod article schemas
└── mastra/
    ├── index.ts                   Mastra registration, storage, observability
    ├── agents/
    │   ├── getNews.ts             webAgent (browser research)
    │   ├── extractionNews.ts      structured extraction agent
    │   ├── structureResult.ts     JSON-structuring agent
    │   └── postNews.ts            postingAgent for X drafts (defined, not registered)
    ├── lib/
    │   ├── env.ts                 requireEnv helper
    │   ├── helper.ts              HH:MM → seconds
    │   └── newsLinks.ts           newsUrlList
    ├── tools/                     article loading/saving, Telegram preview/approval/post, drafting
    └── workflow/
        ├── getNews.ts             extractionWorkflow (scheduled)
        ├── processSite.ts         parse-url-workflow (one site)
        └── postNews.ts            post-news-workflow (review + publish)
```

## Commands

```shell
npm run dev      # start Mastra Studio with hot reload
npm run build    # production build (use instead of `mastra build`)
npm run start    # start the built app
```

## Troubleshooting

- **`DATABASE_URL is not set`** — add it to `.env` and use the compose port (5632), not 5432.
- **`No news URL is scheduled` / skipped result** — every source in `newsUrlList` is earlier than the current time. Add or adjust a `time` entry.
- **`No articles` in `postNewsWorkflow`** — articles must exist with `posted_at IS NULL` and status `fetched` or `NULL`.
- **Telegram 403 / "not enough rights"** — promote the bot to channel administrator with posting permission, and confirm the numeric channel ID.
- **Preview sent but no decision** — the approval step polls for 60 minutes; approve or reject in the review chat within that window.

## Learn more

- [Mastra documentation](https://mastra.ai/docs/)
- [Mastra Studio overview](https://mastra.ai/docs/studio/overview)
- [Mastra platform](https://projects.mastra.ai)
