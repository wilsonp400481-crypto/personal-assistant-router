import type { Config } from "@netlify/functions";

declare const Netlify: {
  env: {
    get(name: string): string | undefined;
  };
};

type TelegramUpdate = {
  message?: {
    chat?: { id?: number | string };
    text?: string;
  };
};

type TelegramReplyMarkup = {
  inline_keyboard: Array<Array<{ text: string; url: string }>>;
};

function env(name: string) {
  return Netlify.env.get(name);
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function appLinks() {
  const billAssistantUrl = env("BILL_ASSISTANT_URL");
  const investAssistantUrl = env("INVEST_ASSISTANT_URL");

  return {
    billAssistantUrl: billAssistantUrl ? normalizeBaseUrl(billAssistantUrl) : "",
    investAssistantUrl: investAssistantUrl ? normalizeBaseUrl(investAssistantUrl) : "",
  };
}

async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  replyMarkup?: TelegramReplyMarkup,
) {
  const token = env("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

function helpText() {
  return [
    "\u500b\u4eba\u52a9\u7406\u5165\u53e3",
    "",
    "/bill - \u8a62\u554f\u7e73\u8cbb\u52a9\u7406",
    "/bill week - \u67e5\u770b 7 \u5929\u5167\u7684\u5e33\u55ae",
    "/bill next - \u67e5\u770b 90 \u5929\u5167\u7684\u5e33\u55ae",
    "/bill done <id> - \u6a19\u8a18\u5df2\u5b8c\u6210",
    "",
    "/invest <\u554f\u984c> - \u8a62\u554f\u6295\u8cc7\u52a9\u7406",
    "",
    "\u4e5f\u53ef\u4ee5\u76f4\u63a5\u9ede\u4e0b\u65b9\u6309\u9215\u958b\u555f PWA\u3002",
  ].join("\n");
}

function appKeyboard(): TelegramReplyMarkup | undefined {
  const { billAssistantUrl, investAssistantUrl } = appLinks();
  const row: Array<{ text: string; url: string }> = [];

  if (billAssistantUrl && billAssistantUrl !== "https://example.com") {
    row.push({ text: "\u958b\u555f\u7e73\u8cbb PWA", url: billAssistantUrl });
  }

  if (investAssistantUrl && investAssistantUrl !== "https://example.com") {
    row.push({ text: "\u958b\u555f\u6295\u8cc7 PWA", url: investAssistantUrl });
  }

  return row.length ? { inline_keyboard: [row] } : undefined;
}

function routeFor(text: string) {
  if (text.startsWith("/bill")) {
    return env("BILL_ASSISTANT_URL");
  }
  if (text.startsWith("/invest")) {
    return env("INVEST_ASSISTANT_URL");
  }
  return null;
}

async function forwardUpdate(targetBaseUrl: string, update: TelegramUpdate) {
  const target = `${normalizeBaseUrl(targetBaseUrl)}/api/telegram-webhook`;
  const response = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });

  if (!response.ok) {
    throw new Error(`Assistant webhook failed: ${response.status} ${await response.text()}`);
  }
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const update = await req.json() as TelegramUpdate;
  const chatId = update.message?.chat?.id;
  const text = update.message?.text?.trim() ?? "";

  if (!chatId || !text) {
    return Response.json({ ok: true, ignored: true });
  }

  if (text.startsWith("/start") || text.startsWith("/help") || text.startsWith("/apps")) {
    await sendTelegramMessage(chatId, helpText(), appKeyboard());
    return Response.json({ ok: true, routed: "help" });
  }

  const target = routeFor(text);
  if (!target) {
    await sendTelegramMessage(chatId, helpText(), appKeyboard());
    return Response.json({ ok: true, routed: "help" });
  }

  try {
    await forwardUpdate(target, update);
    return Response.json({ ok: true, routed: target });
  } catch (error) {
    console.error(error);
    await sendTelegramMessage(chatId, "\u52a9\u7406\u66ab\u6642\u6c92\u6709\u56de\u61c9\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\u3002");
    return Response.json({ ok: false, error: String(error) }, { status: 502 });
  }
};

export const config: Config = {
  path: "/api/telegram-router",
  method: ["POST"],
};
