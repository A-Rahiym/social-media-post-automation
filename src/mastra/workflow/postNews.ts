// src/mastra/workflow/postNews.ts
//
// Processes ONE article per run. Run this workflow on a schedule (e.g. every
// few minutes) rather than batching several articles inside one run — that's
// what keeps Telegram's polling-based approval simple and race-free (see
// telegramApproval.ts). Each run: load -> draft -> preview -> approve ->
// post (if approved) -> record -> confirm.

import {createStep, createWorkflow} from "@mastra/core/workflows";
import { z } from "zod";
import "dotenv/config";
import { getArticlesTool } from "../tools/getArticles";
import { draftPostsTool } from "../tools/draftPosts";
import { sendTelegramPreviewTool } from "../tools/telegramPreview";
import { markPreviewedTool } from "../tools/markPreviewed";
import { awaitTelegramApprovalTool } from "../tools/telegramApproval";
import { postToTelegramTool } from "../tools/postToTelegram";
import { markPostedTool } from "../tools/markPosted";
import { sendTelegramConfirmTool } from "../tools/telegramConfirm";
import { requireEnv } from "../lib/env";


const loadStep = createStep(getArticlesTool);
const draftStep = createStep(draftPostsTool);

// Sends the review card and marks the article 'previewed' so a second run
// can't grab it while it's awaiting a decision.
const previewStep = createStep({
  id: "preview",
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
    articleId: z.number(),
    title: z.string(),
    text: z.string(),
    previewMessageId: z.string(),
  }),
  execute: async ({ inputData }) => {
    const draft = inputData.drafts[0];
    if (!draft) throw new Error("No draft to preview");

    const { previewMessageId } = await sendTelegramPreviewTool.execute!({
      articleId: draft.articleId,
      title: draft.title,
      url: draft.url,
      text: draft.text,
    }, {} as never) as { previewMessageId: string };

    await markPreviewedTool.execute!({
      articleId: draft.articleId,
      previewMessageId,
    }, {} as never);

    return {
      articleId: draft.articleId,
      title: draft.title,
      text: draft.text,
      previewMessageId,
    };
  },
});

const approvalStep = createStep({
  id: "approval",
  inputSchema: z.object({
    articleId: z.number(),
    title: z.string(),
    text: z.string(),
    previewMessageId: z.string(),
  }),
  outputSchema: z.object({
    articleId: z.number(),
    title: z.string(),
    text: z.string(),
    previewMessageId: z.string(),
    decision: z.enum(["approved", "rejected", "timed_out"]),
  }),
  execute: async ({ inputData }) => {
    const { decision } = await awaitTelegramApprovalTool.execute!({
      articleId: inputData.articleId,
      timeoutMinutes: 60,
    }, {} as never) as { decision: "approved" | "rejected" | "timed_out" };
    return { ...inputData, decision };
  },
});

const postStep = createStep({
  id: "post",
  inputSchema: z.object({
    articleId: z.number(),
    title: z.string(),
    text: z.string(),
    previewMessageId: z.string(),
    decision: z.enum(["approved", "rejected", "timed_out"]),
  }),
  outputSchema: z.object({
    articleId: z.number(),
    title: z.string(),
    text: z.string(),
    previewMessageId: z.string(),
    status: z.enum(["posted", "rejected", "skipped"]),
    postId: z.string().nullable(),
  }),
  execute: async ({ inputData }) => {
    if (inputData.decision === "approved") {
      const { postId } = await postToTelegramTool.execute!({ text: inputData.text }, {} as never) as { postId: string };
      return {
        articleId: inputData.articleId,
        title: inputData.title,
        text: inputData.text,
        previewMessageId: inputData.previewMessageId,
        status: "posted" as const,
        postId,
      };
    }

    const status = inputData.decision === "rejected" ? "rejected" as const : "skipped" as const;
    return {
      articleId: inputData.articleId,
      title: inputData.title,
      text: inputData.text,
      previewMessageId: inputData.previewMessageId,
      status,
      postId: null,
    };
  },
});

const recordStep = createStep({
  id: "record",
  inputSchema: z.object({
    articleId: z.number(),
    title: z.string(),
    text: z.string(),
    previewMessageId: z.string(),
    status: z.enum(["posted", "rejected", "skipped"]),
    postId: z.string().nullable(),
  }),
  outputSchema: z.object({
    title: z.string(),
    status: z.enum(["posted", "rejected", "skipped"]),
    postUrl: z.string().nullable(),
  }),
  execute: async ({ inputData }) => {
    await markPostedTool.execute!({
      articleId: inputData.articleId,
      status: inputData.status,
      postDraft: inputData.text,
      previewMessageId: inputData.previewMessageId,
      postId: inputData.postId,
    }, {} as never);

    const postUrl = inputData.postId
      ? `https://t.me/${requireEnv("TELEGRAM_CHANNEL_USERNAME").replace(/^@/, "")}/${inputData.postId}`
      : null;

    return { title: inputData.title, status: inputData.status, postUrl };
  },
});

const confirmStep = createStep({
  id: "confirm",
  inputSchema: z.object({
    title: z.string(),
    status: z.enum(["posted", "rejected", "skipped"]),
    postUrl: z.string().nullable(),
  }),
  outputSchema: z.object({ status: z.string() }),
  execute: async ({ inputData }) => {
    await sendTelegramConfirmTool.execute!(inputData, {} as never);
    return { status: inputData.status };
  },
});

export const postNewsWorkflow = createWorkflow({
  id: "post-news-workflow",
  inputSchema: z.object({ limit: z.number().default(1) }),
  outputSchema: z.object({ status: z.string() }),
})
  .then(loadStep)
  .then(draftStep)
  .then(previewStep)
  .then(approvalStep)
  .then(postStep)
  .then(recordStep)
  .then(confirmStep)
  .commit();
