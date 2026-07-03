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

type NotionText = {
  type: "text";
  text: { content: string };
};

type MemoryClassification = {
  category: "任務" | "專案資訊" | "決策" | "想法" | "文件" | "待追蹤" | "其他";
  priority: "高" | "中" | "低";
  needsConfirm: boolean;
  summary: string;
  detectedDate?: string;
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

function investWebhookPath() {
  return env("INVEST_ASSISTANT_WEBHOOK_PATH") || "/.netlify/functions/amber-telegram";
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
    "/bill rule <\u540d\u7a31> <\u4e0b\u4e00\u6b21\u5230\u671f\u65e5> <\u9593\u9694\u6708\u6578> [\u91d1\u984d]",
    "",
    "/invest <\u554f\u984c> - \u8a62\u554f\u6295\u8cc7\u52a9\u7406",
    "/mem <\u5167\u5bb9> - \u8a18\u5230 Notion \u6536\u4ef6\u7bb1",
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
  if (text.startsWith("/mem")) {
    return { name: "\u8a18\u61b6\u52a9\u7406", url: "notion" };
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
      return "\u683c\u5f0f\uff1a/bill rule <\u540d\u7a31> <\u4e0b\u4e00\u6b21\u5230\u671f\u65e5> <\u9593\u9694\u6708\u6578> [\u91d1\u984d]\n\u4f8b\uff1a/bill rule \u96fb\u8cbb 2026-07-15 2 1200";
    }
    const usesDate = /^\d{4}-\d{2}-\d{2}$/.test(parts[3]);
    if (!usesDate && !Number.isFinite(Number(parts[3]))) {
      return "\u4e0b\u4e00\u6b21\u5230\u671f\u65e5\u8acb\u7528 YYYY-MM-DD\uff0c\u4f8b\u5982 2026-07-15\u3002";
    }
    const data = await billApi(billAssistantUrl, "/api/rules", {
      method: "POST",
      body: JSON.stringify({
        title: parts[2],
        due_day: usesDate ? undefined : Number(parts[3]),
        next_due_date: usesDate ? parts[3] : null,
        interval_months: Number(parts[4]),
        amount_estimated: parts[5] ? Number(parts[5]) : null,
        category: "other",
      }),
    });
    const nextText = data.rule.next_due_date ? `\uff0c\u4e0b\u6b21 ${data.rule.next_due_date}` : `\uff0c\u6bcf\u671f ${data.rule.due_day} \u865f`;
    return `\u5df2\u65b0\u589e\u898f\u5247\uff1a${data.rule.title}\uff0c\u6bcf ${data.rule.interval_months} \u500b\u6708${nextText}`;
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
  const target = `${normalizeBaseUrl(targetBaseUrl)}${investWebhookPath()}`;
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

function trimCommand(text: string, command: string) {
  return text.slice(command.length).trim();
}

function cleanMemoryContent(text: string) {
  return text
    .replace(/^\s*(記一下|記錄|memo|note)\s*[:：]?\s*/i, "")
    .trim();
}

function titleFromMemory(content: string) {
  const firstLine = content.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "未命名記錄";
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine;
}

function richText(content: string): NotionText[] {
  return [{ type: "text", text: { content: content.slice(0, 2000) } }];
}

function includesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function detectDate(content: string) {
  const isoDate = content.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (isoDate) {
    const [, year, month, day] = isoDate;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const monthDay = content.match(/\b(\d{1,2})[/-](\d{1,2})\b/);
  if (monthDay) {
    const now = new Date();
    const [, month, day] = monthDay;
    return `${now.getFullYear()}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const today = new Date();
  if (content.includes("今天")) return formatDate(today);
  if (content.includes("明天")) return formatDate(addDays(today, 1));
  if (content.includes("後天")) return formatDate(addDays(today, 2));
  if (content.includes("下週") || content.includes("下周")) return formatDate(addDays(today, 7));
  if (content.includes("月底")) {
    return formatDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  }

  return undefined;
}

function summarizeMemory(content: string) {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}

function classifyMemory(content: string): MemoryClassification {
  const normalized = content.toLowerCase();
  const detectedDate = detectDate(content);
  const needsConfirm = includesAny(content, ["確認", "待確認", "問一下", "問問", "查一下", "查詢", "不確定"]);

  let category: MemoryClassification["category"] = "其他";
  if (includesAny(content, ["決定", "決議", "結論", "採用", "不採用", "選擇"])) {
    category = "決策";
  } else if (includesAny(content, ["文件", "合約", "保單", "發票", "收據", "截圖", "照片", "pdf", "檔案"])) {
    category = "文件";
  } else if (includesAny(content, ["要做", "待辦", "提醒", "追蹤", "確認", "聯絡", "回覆", "處理", "安排", "預約", "完成"])) {
    category = detectedDate ? "任務" : "待追蹤";
  } else if (includesAny(content, ["專案", "預算", "報價", "需求", "規格", "時程", "客戶", "供應商", "合作"])) {
    category = "專案資訊";
  } else if (includesAny(content, ["想法", "idea", "可以試", "也許", "靈感", "構想"])) {
    category = "想法";
  } else if (includesAny(normalized, ["note", "memo", "knowledge", "how to", "sop"])) {
    category = "想法";
  }

  const priority = includesAny(content, ["緊急", "重要", "今天", "明天", "到期", "逾期"])
    ? "高"
    : detectedDate || needsConfirm
      ? "中"
      : "低";

  return {
    category,
    priority,
    needsConfirm,
    summary: summarizeMemory(content),
    detectedDate,
  };
}

function paragraphChildren(content: string) {
  const chunks: string[] = [];
  for (let index = 0; index < content.length; index += 1900) {
    chunks.push(content.slice(index, index + 1900));
  }
  return chunks.slice(0, 20).map((chunk) => ({
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: richText(chunk),
    },
  }));
}

async function createNotionInboxItem(content: string) {
  const token = env("NOTION_TOKEN");
  const databaseId = env("NOTION_INBOX_DATABASE_ID");
  if (!token) throw new Error("Missing NOTION_TOKEN");
  if (!databaseId) throw new Error("Missing NOTION_INBOX_DATABASE_ID");

  const title = titleFromMemory(content);
  const classification = classifyMemory(content);
  const response = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: {
        "\u6a19\u984c": { title: richText(title) },
        "\u539f\u59cb\u5167\u5bb9": { rich_text: richText(content) },
        "\u6458\u8981": { rich_text: richText(classification.summary) },
        "\u4f86\u6e90": { select: { name: "Telegram" } },
        "\u5206\u985e": { select: { name: classification.category } },
        "\u91cd\u8981\u5ea6": { select: { name: classification.priority } },
        "\u8655\u7406\u72c0\u614b": { select: { name: classification.needsConfirm ? "\u9700\u8981\u78ba\u8a8d" : "\u5df2\u5206\u985e" } },
        "\u9700\u8981\u78ba\u8a8d": { checkbox: classification.needsConfirm },
        ...(classification.detectedDate
          ? { "\u5075\u6e2c\u671f\u9650": { date: { start: classification.detectedDate } } }
          : {}),
      },
      children: paragraphChildren(content),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${body.slice(0, 500)}`);
  }

  const page = await response.json() as { url?: string };
  return { page, classification };
}

async function handleMemoryCommand(text: string) {
  const content = cleanMemoryContent(trimCommand(text, "/mem"));
  if (!content) {
    return [
      "\u683c\u5f0f\uff1a/mem <\u60f3\u8a18\u9304\u7684\u5167\u5bb9>",
      "",
      "\u4f8b\uff1a/mem \u6469\u5bf6\u667a\u8ca9\u6a5f\u4e0b\u9031\u8981\u78ba\u8a8d\u5831\u50f9\uff0c\u9084\u8981\u554f\u5834\u5730\u65b9\u96fb\u529b\u898f\u683c",
    ].join("\n");
  }

  const { page, classification } = await createNotionInboxItem(content);
  return [
    "\u5df2\u8a18\u5230 Notion \u6536\u4ef6\u7bb1\u3002",
    "",
    `\u6a19\u984c\uff1a${titleFromMemory(content)}`,
    `\u5206\u985e\uff1a${classification.category}`,
    `\u91cd\u8981\u5ea6\uff1a${classification.priority}`,
    classification.detectedDate ? `\u5075\u6e2c\u671f\u9650\uff1a${classification.detectedDate}` : "",
    classification.needsConfirm ? "\u72c0\u614b\uff1a\u9700\u8981\u78ba\u8a8d" : "\u72c0\u614b\uff1a\u5df2\u5206\u985e",
    page.url ? `\u9023\u7d50\uff1a${page.url}` : "",
  ].filter(Boolean).join("\n");
}

function targetTextForError(route: { name: string; url?: string }, text: string) {
  if (text.startsWith("/mem")) return "Notion Inbox";
  if (!route.url) return route.name;
  return `${normalizeBaseUrl(route.url)}${text.startsWith("/bill") ? "/api/bills" : investWebhookPath()}`;
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

    if (text.startsWith("/mem")) {
      const reply = await handleMemoryCommand(text);
      await sendTelegramMessage(chatId, reply, appKeyboard());
      return Response.json({ ok: true, routed: "notion-inbox" });
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
        `\u76ee\u6a19\uff1a${targetTextForError(route, text)}`,
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
