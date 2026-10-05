// src/mastra/workflow/postNews.ts
//
// Processes each article independently through preview -> approve -> post ->
// record -> confirm. Mastra's foreach() keeps the per-article steps isolated
// while allowing a batch of drafts to flow through the workflow.

import { createStep, createWorkflow } from "@mastra/core/workflows";
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

// Sends one review card and marks that article 'previewed' so a second run
// can't grab it while it's awaiting a decision.
const previewStep = createStep({
  id: "preview",
  description: "Send one drafted article to Telegram for review and mark it as awaiting a decision.",
  inputSchema: z.object({
    articleId: z.number(),
    title: z.string(),
    url: z.string(),
    text: z.string(),
  }),
  outputSchema: z.object({
    articleId: z.number(),
    title: z.string(),
    text: z.string(),
    previewMessageId: z.string(),
  }),
  execute: async ({ inputData }) => {
    const { previewMessageId } = (await sendTelegramPreviewTool.execute!(
      {
        articleId: inputData.articleId,
        title: inputData.title,
        url: inputData.url,
        text: inputData.text,
      },
      {} as never,
    )) as { previewMessageId: string };

    await markPreviewedTool.execute!(
      {
        articleId: inputData.articleId,
        previewMessageId,
      },
      {} as never,
    );

    return {
      articleId: inputData.articleId,
      title: inputData.title,
      text: inputData.text,
      previewMessageId,
    };
  },
});

const approvalStep = createStep({
  id: "approval",
  description: "Wait for the reviewer's decision for one Telegram preview.",
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
    const { decision } = (await awaitTelegramApprovalTool.execute!(
      {
        articleId: inputData.articleId,
        timeoutMinutes: 60,
      },
      {} as never,
    )) as { decision: "approved" | "rejected" | "timed_out" };

    return { ...inputData, decision };
  },
});

const postStep = createStep({
  id: "post",
  description: "Publish an approved draft to the Telegram channel and skip rejected or timed-out drafts.",
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
      const { postId } = (await postToTelegramTool.execute!(
        { text: inputData.text },
        {} as never,
      )) as { postId: string };
      return {
        articleId: inputData.articleId,
        title: inputData.title,
        text: inputData.text,
        previewMessageId: inputData.previewMessageId,
        status: "posted" as const,
        postId,
      };
    }

    const status =
      inputData.decision === "rejected"
        ? ("rejected" as const)
        : ("skipped" as const);
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
  description: "Persist the article's publication decision and Telegram identifiers in the database.",
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
    await markPostedTool.execute!(
      {
        articleId: inputData.articleId,
        status: inputData.status,
        postDraft: inputData.text,
        previewMessageId: inputData.previewMessageId,
        postId: inputData.postId,
      },
      {} as never,
    );

    const postUrl = inputData.postId
      ? `https://t.me/${requireEnv("TELEGRAM_CHANNEL_USERNAME").replace(/^@/, "")}/${inputData.postId}`
      : null;

    return { title: inputData.title, status: inputData.status, postUrl };
  },
});

const confirmStep = createStep({
  id: "confirm",
  description: "Notify the reviewer of the final outcome for one article.",
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
  description: "Drafts news articles, reviews each draft in Telegram, publishes approved items, and records every outcome.",
  inputSchema: z.object({ limit: z.number().default(1) }),
  outputSchema: z.array(z.object({ status: z.string() })),
})
  .then(loadStep)
  .then(draftStep)
  .map(async ({ inputData }) => inputData.drafts)
  .foreach(previewStep)
  .foreach(approvalStep)
  .foreach(postStep)
  .foreach(recordStep)
  .foreach(confirmStep)
  .commit();
