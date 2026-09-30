// src/mastra/workflow/postNews.ts
//
// POSTING WORKFLOW — independent per-article review and publishing.
//
// Goal: every drafted article is previewed, reviewed, posted, and
// recorded independently. One article waiting for approval, timing out,
// or failing to post must never block the other articles.
//
// Pipeline (X only for now; LinkedIn/Facebook adapters plug in later):
//
//   loadStep          getArticlesTool      unposted articles from Postgres
//   draftStep         draftPostsTool       one X draft per article (postingAgent)
//   sendPreviewsStep  send ALL Telegram previews first (bounded concurrency 3),
//                     so no article waits for another's human decision.
//                     A failed preview send records that article as skipped
//                     right away instead of failing the run.
//   processArticles   .foreach(concurrency 3) — one unit per article:
//                       1. awaitDecision() polls Postgres for the human's
//                          approve/reject (written by POST /webhooks/telegram).
//                          Timeout (TELEGRAM_APPROVAL_TIMEOUT_MINUTES,
//                          default 60) counts as "do not post".
//                       2. approved -> postToX -> record "posted".
//                          X API failure -> record "failed" (NOT posted, so a
//                          later run re-selects it — see getArticlesTool).
//                          rejected/timed_out -> record "rejected"/"skipped"
//                          without ever calling X.
//   summarizeStep     collects per-article {articleId, status} into {results}.
//
// Design notes:
// - Human decisions live in the `review_decisions` Postgres table, not in
//   memory and not in Telegram getUpdates offsets: reviews survive process
//   restarts and need no per-article poller (polling + webhooks compete for
//   the same Telegram update stream, so getUpdates is never used here).
// - Workflow steps call the shared service functions in lib/posting.ts,
//   lib/telegram.ts and lib/reviewDecisions.ts directly. They do NOT call
//   `tool.execute()` — a tool's execute takes (inputData, context) and may
//   return void|ValidationError, which does not fit step code. The Mastra
//   tools in tools/ wrap the same service functions for Studio use.

import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { getArticlesTool } from "../tools/getArticles";
import { draftPostsTool } from "../tools/draftPosts";
import { sendPreviewCard } from "../lib/telegram";
import { awaitDecision } from "../lib/reviewDecisions";
import { postToX, recordArticleOutcome } from "../lib/posting";

const PREVIEW_CONCURRENCY = 3;

const draftSchema = z.object({
  articleId: z.number(),
  title: z.string(),
  url: z.string(),
  text: z.string(),
});

const previewItemSchema = draftSchema.extend({
  previewMessageId: z.string().nullable(),
  previewError: z.string().nullable(),
});

type Draft = z.infer<typeof draftSchema>;
type PreviewItem = z.infer<typeof previewItemSchema>;

/** Runs fn over items with at most `limit` in flight; order preserved. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

const loadStep = createStep(getArticlesTool);
const draftStep = createStep(draftPostsTool);

// Sends every preview before any approval is awaited, so a slow reviewer
// on article 1 cannot delay the previews for articles 2..n.
const sendPreviewsStep = createStep({
  id: "send-previews",
  description:
    "Sends a Telegram preview for every draft (bounded concurrency).",
  inputSchema: z.object({ drafts: z.array(draftSchema) }),
  outputSchema: z.array(previewItemSchema),
  execute: async ({ inputData }): Promise<PreviewItem[]> => {
    return mapWithConcurrency(
      inputData.drafts,
      PREVIEW_CONCURRENCY,
      async (draft: Draft): Promise<PreviewItem> => {
        try {
          const previewMessageId = await sendPreviewCard(draft);
          console.log(
            `Sent Telegram preview for article ${draft.articleId} (messageId ${previewMessageId})`,
          );
          return { ...draft, previewMessageId, previewError: null };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          await recordArticleOutcome({
            articleId: draft.articleId,
            status: "skipped",
            postDraft: draft.text,
            previewMessageId: null,
            postId: null,
          });
          return { ...draft, previewMessageId: null, previewError: message };
        }
      },
    );
  },
});

// One independent unit per article, run via .foreach() with bounded
// concurrency. Errors are contained: one article's failure only affects
// its own result entry.
const processArticleStep = createStep({
  id: "process-article",
  description:
    "Waits for the article's Telegram decision, posts to X if approved, records the outcome.",
  inputSchema: previewItemSchema,
  outputSchema: z.object({ articleId: z.number(), status: z.string() }),
  execute: async ({ inputData }) => {
    const { articleId, text, previewMessageId, previewError } = inputData;
    console.log(`Processing article.................${articleId}`);
    if (previewError) {
      // Already recorded as skipped by sendPreviewsStep.
      return { articleId, status: "skipped" };
    }

    const decision = await awaitDecision(articleId);

    if (decision !== "approved") {
      const status = decision === "rejected" ? "rejected" : "skipped";
      return recordArticleOutcome({
        articleId,
        status,
        postDraft: text,
        previewMessageId,
        postId: null,
      });
    }

    try {
      const postId = await postToX(text);
      return recordArticleOutcome({
        articleId,
        status: "posted",
        postDraft: text,
        previewMessageId,
        postId,
      });
    } catch {
      // Never mark as posted unless X confirms. "failed" articles stay
      // re-selectable by getArticlesTool for a later run.
      return recordArticleOutcome({
        articleId,
        status: "failed",
        postDraft: text,
        previewMessageId,
        postId: null,
      });
    }
  },
});

const summarizeStep = createStep({
  id: "summarize-results",
  inputSchema: z.array(z.object({ articleId: z.number(), status: z.string() })),
  outputSchema: z.object({
    results: z.array(z.object({ articleId: z.number(), status: z.string() })),
  }),
  execute: async ({ inputData }) => ({ results: inputData }),
});

export const postNewsWorkflow = createWorkflow({
  id: "post-news-workflow",
  description:
    "Drafts X posts for unposted articles, previews each on Telegram for independent human review, posts approved drafts to X, and records per-article outcomes.",
  inputSchema: z.object({ limit: z.number().default(5) }),
  outputSchema: z.object({
    results: z.array(z.object({ articleId: z.number(), status: z.string() })),
  }),
})
  .then(loadStep)
  .then(draftStep)
  .then(sendPreviewsStep)
  .foreach(processArticleStep, { concurrency: 3 })
  .then(summarizeStep)
  .commit();
