# ARCHITECTURE — social-media-post-automation

> Handoff document for the next agent taking over this project.
> Covers: as-built system, tech specs, project structure, posting-workflow build plan (Telegram review, X-first multi-platform), OAuth options.

## 1. Project overview

**Goal:** Automatically extract recent Nigerian news articles, store them as structured data in Postgres, then draft, human-review (via Telegram), and publish social-media posts (X first, multi-platform-ready).

**Two pipelines:**

| Pipeline | File | Status |
|---|---|---|
| `extractNews` (Extraction-workflow) | `src/mastra/workflow/extractNews.ts` | Built, scheduled every 5 min |
| `postNews` | `src/mastra/workflow/postNews.ts` | **Placeholder — 0 bytes, unregistered. This is the next build.** |

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
├── .env / .env.example             # NOTE: .env.example only has GOOGLE_GENERATIVE_AI_API_KEY — incomplete (see §9)
├── src/
│   ├── browser/
│   │   └── agentBrowser.ts         # shared AgentBrowser instance, headless:true
│   ├── schema/
│   │   └── articleSchema.ts        # shared zod schema (single source of truth)
│   └── mastra/
│       ├── index.ts                # Mastra root: agents, workflows, tools, storage, observability
│       ├── lib/
│       │   └── newsLinks.ts        # default source list (punch, dailytrust, vanguard)
│       ├── agents/
│       │   ├── webAgent.ts         # fetch-only news researcher (has browser)
│       │   ├── extractionAgent.ts  # raw text → JSON text (no browsing)
│       │   └── structuredOutputAgent.ts  # text → validated structured objects
│       ├── tools/
│       │   ├── saveArticle.ts      # pg upsert into articles (imports shared schema)
│       │   ├── cleanJson.ts        # fence-strip + JSON.parse + schema validate (currently unwired)
│       │   └── schedule-tools.ts   # start/stop schedule (NOTE: hardcodes agentId 'agent' — stale, see §9)
│       └── workflow/
│           ├── extractNews.ts      # 4-step scheduled extraction pipeline (built)
│           └── postNews.ts         # EMPTY — posting pipeline goes here
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

**`src/mastra/index.ts`**: registers `extractionAgent`, `webAgent`, `structuredOutputAgent`; workflows `{ extractionWorkflow }`; tools `{ startScheduleTool, stopScheduleTool }`; `MastraCompositeStore` (LibSQL default + DuckDB observability domain); `bundler.externals: ['@duckdb/node-bindings']`.

**`docker-compose.yaml`**: `postgres:16-alpine`, container `news_db`, `user/password/mydatabase`, host `5432`, volume `db_data`.

## 4. Storage

- **Postgres `articles` table** (consumed by `saveArticle.ts`; **no migration file exists yet — create one first**):
```sql
CREATE TABLE IF NOT EXISTS articles (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  quote TEXT,
  url TEXT NOT NULL UNIQUE,
  published_at TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
  -- posting extension (add in §6 migration):
  -- status TEXT DEFAULT 'fetched',      -- fetched | previewed | approved | posted | rejected | skipped
  -- post_draft TEXT,
  -- preview_message_id TEXT,
  -- post_ids JSONB,
  -- posted_at TIMESTAMPTZ
);
```
- **Mastra internal**: LibSQL (`file:./mastra.db` or `TURSO_DATABASE_URL/AUTH_TOKEN`), DuckDB observability domain.

## 5. Git history (context for the next agent)

Feature-based commits on `main` (latest-first at time of writing): `51cf81e` 4-step pipeline, `c7df9bb` remove legacy `agent.ts`, `698e4c3` webAgent fetch-only rewrite, `f97f555`/`d8a4ef2` structuring agents, `ee5f303`/`8caa9df` tools, `036d21d` pg infra, `10d322b` newsLinks, `49d649d` schema. Known uncommitted drift at handoff time: `extraction_workflow.ts` → `extractNews.ts` rename plus `index.ts` import change and new empty `postNews.ts` — commit or reconcile before building.

## 6. Posting workflow — build spec (the actual next task)

### 6.1 Requirements

- [ ] SQL migration: `articles` table + posting columns above (status/draft/preview/post_ids/posted_at).
- [ ] `getArticlesTool` (`id: get-unposted-articles`): input `{ limit?: number, status?: 'fetched' }` → `SELECT id,title,summary,quote,url,published_at FROM articles WHERE posted_at IS NULL AND (status IS NULL OR status='fetched') ORDER BY published_at DESC NULLS LAST, id DESC LIMIT n`.
- [ ] `draftPostTool` or `postingAgent.generate`: article → per-platform drafts. X default ≤280 chars incl. link; Luganda/English as per article; 1–3 hashtags; never invent facts; always include source URL; produce `{ platform, text, thread?: string[] }`.
- [ ] `sendTelegramPreviewTool`: grammY/telegraf `sendMessage(chatId, card, { reply_markup: inline_keyboard [Approve ✅, Edit ✏️, Reject ❌] })` → `{ preview_message_id }`. Card = title + summary + URL + draft post(s).
- [ ] `awaitTelegramApprovalTool` (or workflow suspend/resume): wait for `callback_query`/reply from allow-listed chat; timeout (default 60 min) → `skipped`; parse `approve | reject | edit:<text>`.
- [ ] `postToXTool` behind a `SocialAdapter` interface (`post(draft) → { postId }`) so LinkedIn/Facebook adapters plug in later.
- [ ] `markPostedTool`: `UPDATE articles SET status, post_draft, preview_message_id, post_ids, posted_at=now() WHERE id=?`.
- [ ] `postingAgent` (new, no browser): owns voice/hashtag/length rules, calls draft + preview tools, never posts without `approval.status === 'approved'`.
- [ ] `postNews` workflow in `postNews.ts`, registered in `index.ts` workflows.
- [ ] Env: `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_REVIEW_CHAT_ID`, `X_*` (platform keys later).
- [ ] `.env.example` updated with all of the above.

### 6.2 Proposed flow (`postNews` workflow)

```
1. loadStep            getArticlesTool(limit=5) → candidates[]
2. draftStep            postingAgent per article → drafts[] (x + thread variant)
3. previewStep          sendTelegramPreviewTool per draft → preview_message_id, status='previewed'
4. approvalStep         awaitTelegramApprovalTool / suspend-resume → approved | edit | rejected | timed-out
5. postStep (approved)  SocialAdapter.post (X first; LinkedIn/FB fan-out later, Promise.allSettled)
6. recordStep           markPostedTool → status posted/rejected/skipped + post_ids + posted_at
```

Rules: idempotent (dedupe on `url`, safe re-run marks only unposted); rate-limit + exponential backoff on post calls; never post on timeout; edits from Telegram replace draft and re-preview once; all secrets server-side.

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

1. Filename drift: `extraction_workflow.ts` deleted, `extractNews.ts` untracked, `index.ts` modified — reconcile + commit.
2. `postNews.ts` empty + unregistered — the build in §6.
3. No SQL migration file for `articles` (table assumed by tool).
4. `cleanText` unwired; workflow output schema vs `saveStep` return shape mismatch (`articles` vs counts).
5. `schedule-tools.ts` stale `agentId: 'agent'`; extraction cron is workflow-level (`*/5 * * * *`).
6. `.env.example` missing `DATABASE_URL`, OpenRouter, Telegram, X keys.
7. `pnpm build` (Mastra bundler) OOMs in this container; `pnpm tsc --noEmit` passes — verify on a bigger box/CI.

## 9. Run / verify

```sh
docker compose up -d
pnpm install
pnpm tsc --noEmit
pnpm dev          # Studio http://localhost:4111
# set DATABASE_URL=postgresql://user:password@localhost:5432/mydatabase
```

## 10. Suggested commit plan for the next agent

1. `chore(db): add articles migration (+ posting columns)`
2. `feat(tools): add getArticles + markPosted tools`
3. `feat(telegram): add preview + approval tools`
4. `feat(agents): add postingAgent`
5. `feat(social): add SocialAdapter + XAdapter`
6. `feat(workflow): implement postNews pipeline + registration`
7. `chore(env): complete .env.example + docs`
