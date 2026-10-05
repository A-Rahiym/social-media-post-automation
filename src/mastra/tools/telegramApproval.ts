// src/mastra/tools/telegramApproval.ts
//
// NOTE: this uses polling (getUpdates) rather than a webhook + workflow
// suspend/resume. Simpler to run with no extra HTTP infrastructure, at the
// cost of holding this step open for the whole review window. Fine for a
// small, low-volume setup — revisit if you ever run many articles in
// parallel or want the process free to restart mid-review.

import "dotenv/config";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is not set`);
  return value;
}

const POLL_INTERVAL_MS = 5_000;
const TELEGRAM_LONG_POLL_SECONDS = 25;
const REQUEST_TIMEOUT_MS = 35_000;
const MAX_REQUEST_ATTEMPTS = 3;
let updateOffset = 0;
const queuedDecisions = new Map<number, "approved" | "rejected">();

type TelegramResponse = {
  ok?: boolean;
  error_code?: number;
  description?: string;
  result?: Array<Record<string, any>>;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class NonRetryableTelegramError extends Error {}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function requestTelegram(
  method: string,
  url: string,
  init: RequestInit = {},
): Promise<TelegramResponse> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const body = await response.text();
        if (!isRetryableStatus(response.status) || attempt === MAX_REQUEST_ATTEMPTS) {
          throw new NonRetryableTelegramError(
            `Telegram ${method} HTTP ${response.status}: ${body.slice(0, 300)}`,
          );
        }
        lastError = new Error(`HTTP ${response.status}`);
        await sleep(attempt * 1_000);
        continue;
      }

      const data = (await response.json()) as TelegramResponse;
      if (!data.ok) {
        throw new NonRetryableTelegramError(
          `Telegram ${method} API error ${data.error_code ?? "unknown"}: ${data.description ?? "unknown error"}`,
        );
      }
      return data;
    } catch (error) {
      if (error instanceof NonRetryableTelegramError) throw error;
      lastError = error;
      if (attempt === MAX_REQUEST_ATTEMPTS) break;
      await sleep(attempt * 1_000);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Telegram ${method} request failed after ${MAX_REQUEST_ATTEMPTS} attempts: ${message}`);
}

async function acknowledgeCallback(botToken: string, callbackId: string): Promise<void> {
  try {
    await requestTelegram(
      "answerCallbackQuery",
      `https://api.telegram.org/bot${botToken}/answerCallbackQuery`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: callbackId }),
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Telegram callback acknowledgement failed: ${message}`);
  }
}

export const awaitTelegramApprovalTool = createTool({
  id: "await-telegram-approval",

  description:
    "Waits for the reviewer's Approve or Reject button press for one article, while preserving callbacks for other queued reviews.",

  inputSchema: z.object({
    articleId: z.number(),
    timeoutMinutes: z.number().default(60),
  }),

  outputSchema: z.object({
    decision: z.enum(["approved", "rejected", "timed_out"]),
  }),

  execute: async ({ articleId, timeoutMinutes }) => {
    const botToken = requireEnv("TELEGRAM_BOT_TOKEN");
    const allowedChatId = requireEnv("TELEGRAM_REVIEW_CHAT_ID");

    const queuedDecision = queuedDecisions.get(articleId);
    if (queuedDecision) {
      queuedDecisions.delete(articleId);
      return { decision: queuedDecision };
    }

    const deadline = Date.now() + timeoutMinutes * 60_000;

    while (Date.now() < deadline) {
      const data = await requestTelegram(
        "getUpdates",
        `https://api.telegram.org/bot${botToken}/getUpdates?offset=${updateOffset}&timeout=${TELEGRAM_LONG_POLL_SECONDS}`,
      );

      if (data.ok) {
        for (const update of data.result ?? []) {
          updateOffset = update.update_id + 1;

          const callback = update.callback_query;
          if (!callback?.data) continue;

          const fromChatId = String(callback.message?.chat?.id ?? "");
          if (fromChatId !== String(allowedChatId)) continue; // ignore non-allow-listed chats

          const [action, idStr] = callback.data.split(":");
          const callbackArticleId = Number(idStr);
          if (!Number.isInteger(callbackArticleId)) continue;

          const decision: "approved" | "rejected" | null =
            action === "approve"
              ? "approved"
              : action === "reject"
                ? "rejected"
                : null;
          if (!decision) continue;

          await acknowledgeCallback(botToken, String(callback.id));

          if (callbackArticleId === articleId) return { decision };
          queuedDecisions.set(callbackArticleId, decision);
        }
      }

      await sleep(POLL_INTERVAL_MS);
    }

    return { decision: "timed_out" as const };
  },
});
