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

function env(name: string) {
  return Netlify.env.get(name);
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

async function sendTelegramMessage(chatId: string | number, text: string) {
  const token = env("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

function helpText() {
  return [
    "個人助理總入口：",
    "",
    "/invest <問題> - 投資助理",
    "/bill - 繳費助理",
    "/bill week - 7 天內待處理帳單",
    "/bill next - 90 天內待處理帳單",
    "/bill done <id> [金額] - 標記繳費完成",
    "",
    "範例：",
    "/invest 台積電最近怎麼看",
    "/bill week",
  ].join("\n");
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

  if (text.startsWith("/start") || text.startsWith("/help")) {
    await sendTelegramMessage(chatId, helpText());
    return Response.json({ ok: true, routed: "help" });
  }

  const target = routeFor(text);
  if (!target) {
    await sendTelegramMessage(chatId, helpText());
    return Response.json({ ok: true, routed: "help" });
  }

  try {
    await forwardUpdate(target, update);
    return Response.json({ ok: true, routed: target });
  } catch (error) {
    console.error(error);
    await sendTelegramMessage(chatId, "助理暫時無法回應，請稍後再試。");
    return Response.json({ ok: false, error: String(error) }, { status: 502 });
  }
};

export const config: Config = {
  path: "/api/telegram-router",
  method: ["POST"],
};
