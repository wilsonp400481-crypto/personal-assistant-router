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

type Bill = {
  id: number;
  title: string;
  due_date: string;
  amount_estimated: number | null;
  amount_actual: number | null;
  status: string;
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
    return { name: "\u7e73\u8cbb\u52a9\u7406", url: env("BILL_ASSISTANT_URL") };
  }
  if (text.startsWith("/invest")) {
    return { name: "\u6295\u8cc7\u52a9\u7406", url: env("INVEST_ASSISTANT_URL") };
  }
  return null;
}

function todayText() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(dateText: string) {
  const [year, month, day] = dateText.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  const [todayYear, todayMonth, todayDay] = todayText().split("-").map(Number);
  const today = Date.UTC(todayYear, todayMonth - 1, todayDay);
  return Math.round((target - today) / 86400000);
}

function formatAmount(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "\u91d1\u984d\u5f85\u78ba\u8a8d";
  return `NT$${Math.round(value).toLocaleString("zh-TW")}`;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    pending_amount: "\u5f85\u78ba\u8a8d\u91d1\u984d",
    pending_payment: "\u5f85\u8655\u7406",
    pending_confirm: "\u5f85\u78ba\u8a8d\u6263\u6b3e",
    overdue: "\u5df2\u903e\u671f",
    paid: "\u5df2\u5b8c\u6210",
    skipped: "\u5df2\u7565\u904e",
  };
  return labels[status] ?? status;
}

function formatBillLine(bill: Bill) {
  const days = daysBetween(bill.due_date);
  const timing = days < 0
    ? `\u903e\u671f ${Math.abs(days)} \u5929`
    : days === 0
      ? "\u4eca\u5929\u5230\u671f"
      : `${days} \u5929\u5f8c\u5230\u671f`;
  const amount = bill.amount_actual ?? bill.amount_estimated;
  return `${bill.id}. ${bill.title} - ${bill.due_date} - ${timing} - ${formatAmount(amount)} - ${statusLabel(bill.status)}`;
}

async function billApi(baseUrl: string, path: string, init?: RequestInit) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${body.slice(0, 300)}`);
  }
  return response.json();
}

async function handleBillCommand(text: string, billAssistantUrl: string) {
  const parts = text.trim().split(/\s+/);
  const action = parts[1]?.toLowerCase();

  if (action === "add") {
    if (parts.length < 4) {
      return "\u683c\u5f0f\uff1a/bill add <\u540d\u7a31> <YYYY-MM-DD> [\u91d1\u984d]";
    }
    const data = await billApi(billAssistantUrl, "/api/bills", {
      method: "POST",
      body: JSON.stringify({
        title: parts[2],
        due_date: parts[3],
        amount_estimated: parts[4] ? Number(parts[4]) : null,
        category: "other",
        source: "telegram-router",
      }),
    });
    return `\u5df2\u65b0\u589e\uff1a${formatBillLine(data.bill)}`;
  }

  if (action === "rule") {
    if (parts.length < 5) {
      return "\u683c\u5f0f\uff1a/bill rule <\u540d\u7a31> <\u6bcf\u6708\u5e7e\u865f> <\u9593\u9694\u6708\u6578> [\u91d1\u984d]";
    }
    const data = await billApi(billAssistantUrl, "/api/rules", {
      method: "POST",
      body: JSON.stringify({
        title: parts[2],
        due_day: Number(parts[3]),
        interval_months: Number(parts[4]),
        amount_estimated: parts[5] ? Number(parts[5]) : null,
        category: "other",
      }),
    });
    return `\u5df2\u65b0\u589e\u898f\u5247\uff1a${data.rule.title}\uff0c\u6bcf ${data.rule.interval_months} \u500b\u6708 ${data.rule.due_day} \u865f`;
  }

  if (action === "done" || action === "paid") {
    if (parts.length < 3) return "\u683c\u5f0f\uff1a/bill done <id> [\u91d1\u984d]";
    const data = await billApi(billAssistantUrl, `/api/bills/${Number(parts[2])}/paid`, {
      method: "POST",
      body: JSON.stringify({ amount_actual: parts[3] ? Number(parts[3]) : undefined }),
    });
    return data.bill ? `\u5df2\u5b8c\u6210\uff1a${formatBillLine(data.bill)}` : "\u627e\u4e0d\u5230\u9019\u7b46\u5e33\u55ae\u3002";
  }

  const days = action === "week" ? 7 : action === "year" ? 365 : 90;
  await billApi(billAssistantUrl, `/api/generate?days=${days}`);
  const data = await billApi(billAssistantUrl, `/api/bills?days=${days}`);
  const bills = (data.bills ?? []) as Bill[];

  if (!bills.length) {
    return days === 7
      ? "7 \u5929\u5167\u6c92\u6709\u5f85\u8655\u7406\u5e33\u55ae\u3002"
      : `${days} \u5929\u5167\u6c92\u6709\u5f85\u8655\u7406\u5e33\u55ae\u3002`;
  }

  const title = days === 7
    ? "7 \u5929\u5167\u5e33\u55ae"
    : days === 365
      ? "\u4e00\u5e74\u5167\u5e33\u55ae"
      : "90 \u5929\u5167\u5e33\u55ae";
  return [title, ...bills.slice(0, 20).map(formatBillLine)].join("\n");
}

async function forwardUpdate(targetBaseUrl: string, update: TelegramUpdate) {
  const target = `${normalizeBaseUrl(targetBaseUrl)}/api/telegram-webhook`;
  const response = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${body.slice(0, 300)}`);
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

  const route = routeFor(text);
  if (!route) {
    await sendTelegramMessage(chatId, helpText(), appKeyboard());
    return Response.json({ ok: true, routed: "help" });
  }

  if (!route.url || route.url === "https://example.com") {
    await sendTelegramMessage(
      chatId,
      `${route.name}\u9084\u6c92\u6709\u8a2d\u5b9a\u7db2\u5740\uff0c\u8acb\u5148\u5230 Router \u7684 Netlify Environment variables \u88dc\u4e0a\u6b63\u78ba URL\u3002`,
      appKeyboard(),
    );
    return Response.json({ ok: false, routed: route.name, error: "missing target url" }, { status: 502 });
  }

  try {
    if (text.startsWith("/bill")) {
      const reply = await handleBillCommand(text, route.url);
      await sendTelegramMessage(chatId, reply, appKeyboard());
      return Response.json({ ok: true, routed: "bill-api" });
    }

    await forwardUpdate(route.url, update);
    return Response.json({ ok: true, routed: route.url });
  } catch (error) {
    console.error(error);
    await sendTelegramMessage(
      chatId,
      [
        `${route.name}\u66ab\u6642\u6c92\u6709\u56de\u61c9\u3002`,
        "",
        `\u76ee\u6a19\uff1a${normalizeBaseUrl(route.url)}${text.startsWith("/bill") ? "/api/bills" : "/api/telegram-webhook"}`,
        `\u932f\u8aa4\uff1a${String(error).slice(0, 500)}`,
      ].join("\n"),
    );
    return Response.json({ ok: false, error: String(error) }, { status: 502 });
  }
};

export const config: Config = {
  path: "/api/telegram-router",
  method: ["POST"],
};
