# ARCHITECTURE — social-media-post-automation

> Handoff document for the next agent taking over this project.
> Covers: as-built system, tech specs, project structure, posting-workflow build plan (Telegram review, X-first multi-platform), OAuth options.

## 1. Project overview

**Goal:** Automatically extract recent Nigerian news articles, store them as structured data in Postgres, then draft, human-review (via Telegram), and publish social-media posts (X first, multi-platform-ready).

**Two pipelines:**

| Pipeline | File | Status |
|---|---|---|
| `extractNews` (Extraction-workflow) | `src/mastra/workflow/extractNews.ts` | Built, scheduled every 5 min |
| `postNews` | `src/mastra/workflow/postNews.ts` | Built — independent per-article review/post/record (see §6) |

**High-level data flow (target end state):**

```
Nigerian news sites → webAgent → dataExtractionAgent → structuredOutputAgent
  → Postgres articles → postingAgent (draft) → Telegram preview
  → human approve/reject/edit → X / LinkedIn / Facebook → mark posted
```

## 2. Tech stack (pinned)

| Concern | Choice | Version / detail |
|---|---|---|
| Framework | Mastra | `mastra 1.31.2`, `@mastra/core 1.70.0` |
| Browser automation | `@mastra/agent-browser` | `^0.5.3` (`AgentBrowser`, `headless: true`) |
| Models | OpenRouter | `openrouter/google/gemma-4-31b-it` on all 3 agents |
| Validation | zod | `^4.4.3` |
| News DB | Postgres 16 | `postgres:16-alpine` via `docker-compose.yaml`, driver `pg ^8.23.0` (`@types/pg` dev) |
| Mastra storage | LibSQL (memory/tasks/schedules) | `file:./mastra.db`, Turso override via env |
| Observability | DuckDB + Mastra exporters | `DuckDBStore`, `SensitiveDataFilter` |
| Language | TypeScript strict | ES2022, `moduleResolution: bundler`, `noEmit`, `include: src/**/*` |
| Package manager | pnpm | `pnpm-lock.yaml`, `pnpm-workspace.yaml` (`allowBuilds: agent-browser, edgedriver, esbuild, geckodriver`) |
| Runtime | Node | `>=22.13.0` |
| Scripts | `dev` / `build` / `start` | `mastra dev` etc. — **per `AGENTS.md`, always use these scripts, never `mastra` CLI directly; load the `mastra` skill before any Mastra work; register everything in `src/mastra/index.ts`.** |

## 3. Project structure

```
.
├── ARCHITECTURE.md                 # this file
├── AGENTS.md                       # repo rules (mastra skill, registration, scripts)
├── docker-compose.yaml             # local Postgres (news_db, user/password, mydatabase, 5432)
├── package.json / pnpm-lock.yaml / pnpm-workspace.yaml
├── tsconfig.json
├── .env / .env.example             # all required keys documented (DB, Telegram, X, Turso)
├── db/migrations/001_posting.sql  # articles DDL + posting columns + review_decisions
├── src/
│   ├── browser/
│   │   └── agentBrowser.ts         # shared AgentBrowser instance, headless:true
│   ├── schema/
│   │   └── articleSchema.ts        # shared zod schema (single source of truth)
│   └── mastra/
│       ├── index.ts                # Mastra root: agents, workflows, tools, storage, observability, server.apiRoutes
│       ├── lib/
│       │   ├── newsLinks.ts        # default source list (punch, dailytrust, vanguard)
│       │   ├── POSTING_WORKFLOW_PLAN.md  # independent-posting design this section implements
│       │   ├── env.ts              # requireEnv/optionalEnv helpers
│       │   ├── db.ts               # shared lazy pg Pool (DATABASE_URL)
│       │   ├── telegram.ts         # Telegraf singleton + sendPreviewCard + answerCallback (webhook mode, never launch())
│       │   ├── reviewDecisions.ts  # review_decisions persistence: record/get/awaitDecision (first wins, DB-poll wait)
│       │   └── posting.ts          # postToX + recordArticleOutcome — single implementation shared by tools AND workflow steps
│       ├── server/
│       │   └── telegramWebhook.ts  # POST /webhooks/telegram (secret + chat allow-list, idempotent)
│       ├── agents/
│       │   ├── web.ts              # fetch-only news researcher (has browser)
│       │   ├── extraction.ts       # raw text → JSON text (no browsing)
│       │   ├── structuredOutput.ts # text → validated structured objects
│       │   └── postingAgent.ts     # single-X-draft writer (≤280 chars, URL, 1–3 hashtags, no invented facts)
│       ├── tools/
│       │   ├── saveArticle.ts      # pg upsert into articles (imports shared schema)
│       │   ├── cleanJson.ts        # fence-strip + JSON.parse + schema validate (currently unwired)
│       │   ├── getArticles.ts      # unposted + failed (retryable) articles
│       │   ├── draftPosts.ts       # one draft per article via postingAgent
│       │   ├── telegramPreview.ts  # wraps sendPreviewCard
│       │   ├── telegramApproval.ts # wraps awaitDecision (DB wait — getUpdates polling removed)
│       │   ├── postToX.ts          # wraps postToX
│       │   ├── markPosted.ts       # wraps recordArticleOutcome (posted|rejected|skipped|failed)
│       │   └── schedule-tools.ts   # start/stop schedule (NOTE: hardcodes agentId 'agent' — stale, see §9)
│       └── workflow/
│           ├── extractNews.ts      # 4-step scheduled extraction pipeline (built)
│           └── postNews.ts         # independent per-article posting pipeline (built, see §6)
```

### 3.1 File-by-file spec

**`src/schema/articleSchema.ts`** — shared contract. All tools/agents/workflows must import this, never redefine:
```ts
{ title: string, summary: string | null, quote: string | null,
  url: string, publishedAt: string | null }
```

**`src/mastra/lib/newsLinks.ts`** — default workflow input:
```ts
["https://punchng.com/", "https://dailytrust.com/", "https://vanguardngr.com/"]
```

**`src/browser/agentBrowser.ts`** — `new AgentBrowser({ headless: true })`. Changed from `false` → `true` for scheduled/headless runs.

**`src/mastra/agents/webAgent.ts`** (`id: web-agent`, `maxSteps: 100`):
Fetch-only researcher. No DOM clicking/scrolling. Per site: fetch homepage/latest section, find candidates via headlines/timestamps/URL patterns (date slugs, `/article/`, `/story/`), up to 3 genuine news articles per site (skip opinion/sponsored/video-only/category unless nothing else). Concurrent fetches. Output plain text blocks:
```
SOURCE: <site> / HEADLINE: <exact> / URL: <url> / SUMMARY: <original wording>
QUOTE: <optional, <15 words> / NOTES: <skips/paywalls/ordering caveats>
```
Never fabricate; never return full verbatim body.

**`src/mastra/agents/extractionAgent.ts`** (`id: structured-data-extraction-agent`): no web access. Input = webAgent text blocks. Output = strict JSON `{ articles: [...] }` matching schema shape, `null` for missing, no markdown fences, no extra fields.

**`src/mastra/agents/structuredOutputAgent.ts`** (`id: structured-output-agent`): same input contract; additionally strips JSON/Markdown escape artifacts without paraphrasing. Invoked via `agent.generate(text, { structuredOutput: { schema: z.array(articleSchema) } })`.

**`src/mastra/tools/saveArticle.ts`** (`id: save-articles`): input `{ articles }`, output `{ inserted, updated, total }`. Lazy `pg.Pool` from `DATABASE_URL`. Transaction with `BEGIN/COMMIT/ROLLBACK`, per-article:
```sql
INSERT INTO articles (title, summary, quote, url, published_at)
VALUES ($1,$2,$3,$4,$5)
ON CONFLICT (url) DO UPDATE SET title=EXCLUDED.title, summary=EXCLUDED.summary,
  quote=EXCLUDED.quote, published_at=EXCLUDED.published_at
RETURNING (xmax = 0) AS inserted;
```

**`src/mastra/tools/cleanJson.ts`** (`id: clean-news-json`, export `cleanText`): input `{ response: string }`, strips ```` ```json ```` fences, `JSON.parse`, `safeParse` against `{ articles: articleSchema[] }`. **Currently not wired into any workflow** — available for hardening the processing step.

**`src/mastra/tools/schedule-tools.ts`**: `start_schedule` / `stop_schedule`. Stale: references `agentId: 'agent'` which no longer exists (legacy starter agent was deleted). Update when touching schedules.

**`src/mastra/workflow/extractNews.ts`** (`id: Extraction-workflow`, `cron: */5 * * * *`):
1. `fetchingStep` (`extraction`): input `{ urls: z.array(z.url()).default(newsUrlList) }` → `Promise.allSettled(urls.map(webAgent.generate(...)))`, throw if all fail, join successes with `\n\n` → `{ response }`.
2. `processingStep` (`summarizing`): `{ response }` → `dataExtractionAgent` → `{ response }`.
3. `structuredOutputStep` (`structuring`): `{ response }` → `structuredOutputAgent` with structured output → `{ articles: articleSchema[] }`.
4. `saveStep`: `createStep(saveArticlesTool)` → `{ inserted, updated, total }` (workflow output schema declares `articles`-shaped objects; runtime returns tool counts — align on next pass).

**`src/mastra/index.ts`**: registers `extractionAgent`, `webAgent`, `structuredOutputAgent`, `postingAgent`; workflows `{ extractionWorkflow, postNewsWorkflow }`; tools `{ startScheduleTool, stopScheduleTool, getArticlesTool, draftPostsTool, sendTelegramPreviewTool, awaitTelegramApprovalTool, postToXTool, markPostedTool }`; `server.apiRoutes: [telegramWebhookRoute]`; `MastraCompositeStore` (LibSQL default + DuckDB observability domain); `bundler.externals: ['@duckdb/node-bindings']`.

**`docker-compose.yaml`**: `postgres:16-alpine`, container `news_db`, `user/password/mydatabase`, host `5432`, volume `db_data`.

## 4. Storage

- **Postgres `articles` table** — DDL lives in `db/migrations/001_posting.sql` (apply: `psql "$DATABASE_URL" -f db/migrations/001_posting.sql`):
```sql
CREATE TABLE IF NOT EXISTS articles (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  quote TEXT,
  url TEXT NOT NULL UNIQUE,
  published_at TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'fetched',  -- fetched|previewed|posted|rejected|skipped|failed
  post_draft TEXT,
  preview_message_id TEXT,
  post_id TEXT,
  posted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS review_decisions (
  article_id INTEGER PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  decided_at TIMESTAMPTZ DEFAULT now()
);
```
`posted` rows are never re-selected (`posted_at IS NOT NULL` filter); `failed` rows are re-selectable for retry.
- **Mastra internal**: LibSQL (`file:./mastra.db` or `TURSO_DATABASE_URL/AUTH_TOKEN`), DuckDB observability domain.

## 5. Git history (context for the next agent)

Feature-based commits on `main` (latest-first at time of writing): `51cf81e` 4-step pipeline, `c7df9bb` remove legacy `agent.ts`, `698e4c3` webAgent fetch-only rewrite, `f97f555`/`d8a4ef2` structuring agents, `ee5f303`/`8caa9df` tools, `036d21d` pg infra, `10d322b` newsLinks, `49d649d` schema. Known uncommitted drift at handoff time: `extraction_workflow.ts` → `extractNews.ts` rename plus `index.ts` import change and new empty `postNews.ts` — commit or reconcile before building.

## 6. Posting workflow — as built (implements `lib/POSTING_WORKFLOW_PLAN.md`)

`src/mastra/workflow/postNews.ts` (`id: post-news-workflow`, input `{ limit default 5 }` → `{ results: [{ articleId, status }] }`):

```
1. loadStep            getArticlesTool(limit) → { articles } (unposted + failed)
2. draftStep            draftPostsTool → { drafts } (postingAgent, one X draft each)
3. sendPreviewsStep     ALL Telegram previews first, bounded concurrency 3.
                        Preview-send failure → record "skipped" immediately.
4. processArticles      .foreach(processArticleStep, { concurrency: 3 }):
                          previewError → "skipped" (already recorded)
                          awaitDecision() → approved → postToX → "posted"
                            X error → "failed" (re-selectable, never marked posted)
                            rejected/timed_out → "rejected"/"skipped", X never called
5. summarizeStep        foreach array → { results }
```

### 6.1 Key design decisions (read before changing)

- **Decisions live in Postgres** (`review_decisions`, first-wins upsert). The webhook writes, the workflow polls (`awaitDecision`, 5 s interval, `TELEGRAM_APPROVAL_TIMEOUT_MINUTES` default 60). No in-memory state, restart-safe, no per-article `getUpdates` pollers (polling + webhooks compete for one update stream).
- **Steps call service functions, not `tool.execute()`** (`lib/posting.ts`, `lib/telegram.ts`, `lib/reviewDecisions.ts`). Tool `execute` takes `(inputData, context)` and may return `void|ValidationError` — wrong shape for step code. Tools in `tools/` wrap the same functions for Studio use.
- **Single Telegram entry point**: `POST /webhooks/telegram` (custom Hono route, mounted at app root — public URL `{origin}/webhooks/telegram`). Validates `X-Telegram-Bot-Api-Secret-Token` when configured, allow-lists `TELEGRAM_REVIEW_CHAT_ID`, routes `approve:<id>`/`reject:<id>`, always `answerCbQuery`s accepted callbacks, ignores everything else with `200 {ok:true}`.
- **Timeout = do not post.** `timed_out` maps to `skipped`, same as rejected.
- **Remaining gaps**: no `SocialAdapter` abstraction yet (X direct via `twitter-api-v2`); no Telegram edit support (approve/reject only); no X retry/backoff or rate limiting; `cleanText` still unwired; `schedule-tools.ts` stale `agentId`.

### 6.3 Telegram review loop (decided)

- Transport: Telegram bot (`TELEGRAM_BOT_TOKEN`), allow-list `TELEGRAM_REVIEW_CHAT_ID`.
- Preview card includes: headline, summary (truncated), source URL, rendered draft post, Approve/Edit/Reject buttons.
- Approval signal: `callback_query` data (`approve:<articleId>`, `reject:<articleId>`, `edit:<articleId>`) or text reply; record actor + timestamp.
- Timeout → auto-`skipped`, logged in `NOTES`-style field; workflow suspend/resume preferred over busy-polling.

### 6.4 Platform targets (decided: X-first, multi-platform-ready)

- **MVP: X.** Draft ≤280 chars, link card, thread support for long summaries.
- **Abstraction:** `SocialAdapter { post(draft): Promise<{postId}>; delete?(id); }` with `XAdapter` now, `LinkedInAdapter`/`FacebookAdapter` later (org/page IDs, own token scopes, image support optional).
- Keep `platform` field on every draft + result from day one.

## 7. OAuth / credentials (options only — no decision prescribed)

- **Option A — env long-lived tokens (fastest MVP, single user):** `X_API_KEY/SECRET/ACCESS_TOKEN/SECRET` (OAuth 1.0a) or OAuth2 bearer; Telegram bot token; LinkedIn/FB tokens in env. Pro: zero code. Con: no multi-user, manual rotation.
- **Option B — DB-backed OAuth2 (recommended for multi-user):** `social_accounts { provider, account_id, access_token, refresh_token, expires_at, scope }` + token-refresh job + minimal `node:http` callback route storing tokens; workflow loads fresh token per post. Pro: proper expiry/refresh, per-user accounts. Con: more code (callback, encryption at rest).
- **Platform notes:** X rate limits + 1.0a vs 2.0 PKCE trade-offs; LinkedIn `w_member_social` + org-page flow; Facebook Page tokens via `pages_manage_posts`. Never commit secrets; document rotation; encrypt DB tokens.

## 8. Known gaps / tech debt (fix in this order)

1. Commit the posting-pipeline change set (new: `lib/{env,db,telegram,reviewDecisions,posting}.ts`, `server/telegramWebhook.ts`, `db/migrations/001_posting.sql`; rewritten: `workflow/postNews.ts`, `tools/{telegramApproval,telegramPreview,postToX,markPosted,getArticles}.ts`, `index.ts`, `.env.example`, this doc).
2. Apply `db/migrations/001_posting.sql` to the target database, then register the Telegram webhook (`setWebhook` with `TELEGRAM_WEBHOOK_SECRET`) against a public HTTPS URL.
3. `cleanText` unwired; extraction workflow output schema vs `saveStep` return shape mismatch (`articles` vs counts).
4. `schedule-tools.ts` stale `agentId: 'agent'`; extraction cron is workflow-level (`*/5 * * * *`).
5. No X retry/backoff or rate limiting; no Telegram draft-edit support; no `SocialAdapter` abstraction yet.
6. `pnpm build` (Mastra bundler) OOMs in small containers; `pnpm tsc --noEmit` passes — verify on a bigger box/CI.

## 9. Run / verify

```sh
docker compose up -d
pnpm install
psql "$DATABASE_URL" -f db/migrations/001_posting.sql
pnpm tsc --noEmit
pnpm dev          # Studio http://localhost:4111
# set DATABASE_URL=postgresql://user:password@localhost:5432/mydatabase
# register Telegram webhook: setWebhook → https://<public-host>/webhooks/telegram
```

## 10. Suggested commit plan for the remaining hardening

1. `feat(social): add SocialAdapter + XAdapter` (extract from `lib/posting.ts`)
2. `feat(posting): add X retry/backoff + rate limiting`
3. `feat(telegram): add draft-edit support to review loop`
4. `fix(schedule): update stale agentId in schedule-tools`
