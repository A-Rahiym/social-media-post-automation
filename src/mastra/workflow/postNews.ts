// src/mastra/workflow/postNews.ts
//
// Kept intentionally simple: X only, sequential article processing (see
// telegramApproval.ts note on why), no platform abstraction. Widen later
// if/when more platforms are added.


import { createWorkflow, createStep } from "@mastra/core/workflows";
import { z } from "zod";
import { getArticlesTool } from "../tools/getArticles";
import { draftPostsTool } from "../tools/draftPosts";
import { sendTelegramPreviewTool } from "../tools/telegramPreview";
import { awaitTelegramApprovalTool } from "../tools/telegramApproval";
import { postToXTool } from "../tools/postToX";
import { markPostedTool } from "../tools/markPosted";
import { console } from "inspector/promises";

const loadStep = createStep(getArticlesTool);
const draftStep = createStep(draftPostsTool);

// One combined step that runs preview -> approve -> post -> record for a
// single draft, then loops to the next. Kept as one step (rather than four
// chained workflow steps) so the sequential-per-article constraint from
// telegramApproval.ts is impossible to accidentally parallelize later.
const reviewAndPostStep = createStep({
  id: "review-and-post",
  inputSchema: z.object({
    drafts: z.array(
      z.object({
        articleId: z.number(),
        title: z.string(),
        url: z.string(),
        text: z.string(),
      }),
    ),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({ articleId: z.number(), status: z.string() }),
    ),
  }),
  execute: async ({ inputData }) => {
    const results = [];
    console.log(`Processing drafts: ${inputData.drafts.length}`);

    for (const draft of inputData.drafts) {
      const { previewMessageId } = await sendTelegramPreviewTool.execute({
        articleId: draft.articleId,
        title: draft.title,
        url: draft.url,
        text: draft.text,
      });

      console.log(`Telegram preview sent for article ${draft.articleId}, message ID: ${previewMessageId}`);

      const { decision } = await awaitTelegramApprovalTool.execute({
        articleId: draft.articleId,
        timeoutMinutes: 60,
      });
      console.log(`Telegram approval decisi=on for article ${draft.articleId}: ${decision}`);

      if (decision === "approved") {
        // const { postId } = await postToXTool.execute({ text: draft.text });
        //  console.log(`X post ID for article ${draft.articleId}: ${postId}`);
        const record = await markPostedTool.execute({
          articleId: draft.articleId,
          status: "posted",
          postDraft: draft.text,
          previewMessageId,
          postId,
        });

        console.log(`Article ${draft.articleId} marked as posted`);
        results.push(record);
      } else {
        const status = decision === "rejected" ? "rejected" : "skipped";
        const record = await markPostedTool.execute({
          articleId: draft.articleId,
          status,
          postDraft: draft.text,
          previewMessageId,
          postId: null,
        });
        console.log(`Article ${draft.articleId} marked as ${status}`);
        results.push(record);
      }
    }

    return { results };
  },
});

export const postNewsWorkflow = createWorkflow({
  id: "post-news-workflow",
  inputSchema: z.object({ limit: z.number().default(5) }),
  outputSchema: z.object({
    results: z.array(
      z.object({ articleId: z.number(), status: z.string() }),
    ),
  }),
})
  .then(loadStep)
  .then(draftStep)
  .then(reviewAndPostStep)
  .commit();