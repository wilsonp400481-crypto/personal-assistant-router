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

type NotionTextValue = {
  plain_text?: string;
};

type NotionPage = {
  url?: string;
  properties?: Record<string, any>;
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
    "/ask <\u554f\u984c> - \u67e5\u8a62 Notion \u8a18\u61b6",
    "/chatid - \u986f\u793a\u9019\u500b Telegram \u804a\u5929\u7684 ID",
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
  if (text.startsWith("/ask")) {
    return { name: "\u67e5\u8a62\u52a9\u7406", url: "notion" };
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

function taipeiDateText(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDaysText(dateText: string, days: number) {
  const [year, month, day] = dateText.split("-").map(Number);
  return formatDate(addDays(new Date(Date.UTC(year, month - 1, day)), days));
}

function textFromTitle(value: NotionTextValue[] | undefined) {
  return value?.map((item) => item.plain_text ?? "").join("").trim() || "\u672a\u547d\u540d";
}

function textFromRichText(value: NotionTextValue[] | undefined) {
  return value?.map((item) => item.plain_text ?? "").join("").trim() || "";
}

function pageTitle(page: NotionPage) {
  return textFromTitle(page.properties?.["\u6a19\u984c"]?.title);
}

function pageSummary(page: NotionPage) {
  return textFromRichText(page.properties?.["\u6458\u8981"]?.rich_text)
    || textFromRichText(page.properties?.["\u539f\u59cb\u5167\u5bb9"]?.rich_text);
}

function pageSelect(page: NotionPage, propertyName: string) {
  return page.properties?.[propertyName]?.select?.name as string | undefined;
}

function pageDate(page: NotionPage) {
  return page.properties?.["\u5075\u6e2c\u671f\u9650"]?.date?.start as string | undefined;
}

function openInboxFilter(extra?: Record<string, any>) {
  const filters: Array<Record<string, any>> = [
    { property: "\u8655\u7406\u72c0\u614b", select: { does_not_equal: "\u5df2\u6b78\u6a94" } },
    { property: "\u8655\u7406\u72c0\u614b", select: { does_not_equal: "\u7565\u904e" } },
  ];
  if (extra) filters.push(extra);
  return { and: filters };
}

function askFilter(question: string) {
  const today = taipeiDateText();
  const weekEnd = addDaysText(today, 7);
  if (includesAny(question, ["\u4eca\u5929", "\u4eca\u65e5", "today"])) {
    return {
      label: `\u4eca\u5929 ${today} \u5230\u671f\u6216\u903e\u671f\u7684\u8a18\u61b6`,
      filter: openInboxFilter({ property: "\u5075\u6e2c\u671f\u9650", date: { on_or_before: today } }),
    };
  }
  if (includesAny(question, ["\u9019\u9031", "\u672c\u9031", "\u9019\u5468", "\u672c\u5468", "week"])) {
    return {
      label: `\u9019\u9031\uff08\u5230 ${weekEnd}\uff09\u8981\u8ffd\u8e64\u7684\u8a18\u61b6`,
      filter: openInboxFilter({ property: "\u5075\u6e2c\u671f\u9650", date: { on_or_before: weekEnd } }),
    };
  }
  if (includesAny(question, ["\u5f85\u78ba\u8a8d", "\u9700\u8981\u78ba\u8a8d", "\u78ba\u8a8d"])) {
    return {
      label: "\u9700\u8981\u78ba\u8a8d\u7684\u8a18\u61b6",
      filter: openInboxFilter({
        or: [
          { property: "\u9700\u8981\u78ba\u8a8d", checkbox: { equals: true } },
          { property: "\u8655\u7406\u72c0\u614b", select: { equals: "\u9700\u8981\u78ba\u8a8d" } },
        ],
      }),
    };
  }
  if (includesAny(question, ["\u6587\u4ef6", "\u5408\u7d04", "\u4fdd\u55ae", "\u767c\u7968", "\u6a94\u6848", "pdf"])) {
    return {
      label: "\u6587\u4ef6\u985e\u8a18\u61b6",
      filter: openInboxFilter({ property: "\u5206\u985e", select: { equals: "\u6587\u4ef6" } }),
    };
  }
  if (includesAny(question, ["\u4efb\u52d9", "\u5f85\u8fa6", "\u8981\u505a"])) {
    return {
      label: "\u4efb\u52d9\u985e\u8a18\u61b6",
      filter: openInboxFilter({ property: "\u5206\u985e", select: { equals: "\u4efb\u52d9" } }),
    };
  }

  const keyword = question.trim();
  return {
    label: `\u8207\u300c${keyword}\u300d\u76f8\u95dc\u7684\u8a18\u61b6`,
    filter: openInboxFilter({
      or: [
        { property: "\u6a19\u984c", title: { contains: keyword } },
        { property: "\u6458\u8981", rich_text: { contains: keyword } },
        { property: "\u539f\u59cb\u5167\u5bb9", rich_text: { contains: keyword } },
      ],
    }),
  };
}

async function queryInboxItems(filter: Record<string, any>) {
  const token = env("NOTION_TOKEN");
  const databaseId = env("NOTION_INBOX_DATABASE_ID");
  if (!token) throw new Error("Missing NOTION_TOKEN");
  if (!databaseId) throw new Error("Missing NOTION_INBOX_DATABASE_ID");

  const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({
      page_size: 10,
      filter,
      sorts: [
        { property: "\u5075\u6e2c\u671f\u9650", direction: "ascending" },
        { timestamp: "created_time", direction: "descending" },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${body.slice(0, 500)}`);
  }

  const data = await response.json() as { results?: NotionPage[] };
  return data.results ?? [];
}

function formatInboxItems(label: string, pages: NotionPage[]) {
  if (!pages.length) {
    return [
      label,
      "",
      "\u76ee\u524d\u6c92\u6709\u627e\u5230\u7b26\u5408\u689d\u4ef6\u7684\u8a18\u61b6\u3002",
    ].join("\n");
  }

  const lines = pages.map((page, index) => {
    const title = pageTitle(page);
    const date = pageDate(page) ?? "\u672a\u8a2d\u5b9a";
    const category = pageSelect(page, "\u5206\u985e") ?? "\u672a\u5206\u985e";
    const priority = pageSelect(page, "\u91cd\u8981\u5ea6") ?? "\u672a\u8a2d\u5b9a";
    const status = pageSelect(page, "\u8655\u7406\u72c0\u614b") ?? "\u672a\u8a2d\u5b9a";
    const summary = pageSummary(page);
    return [
      `${index + 1}. ${title}`,
      `   \u671f\u9650\uff1a${date} / \u5206\u985e\uff1a${category} / \u91cd\u8981\u5ea6\uff1a${priority} / \u72c0\u614b\uff1a${status}`,
      summary ? `   ${summary.slice(0, 120)}` : "",
      page.url ? `   ${page.url}` : "",
    ].filter(Boolean).join("\n");
  });

  return [label, "", ...lines].join("\n\n");
}

type SearchDatabaseConfig = {
  label: string;
  databaseId: string;
  titleProp: string;
  textProps: string[];
  urlProps?: string[];
  dateProp?: string;
  statusProp?: string;
  typeProp?: string;
  priorityProp?: string;
  closedStatuses?: string[];
};

function databaseConfigs(): SearchDatabaseConfig[] {
  return [
    {
      label: "Inbox 收件箱",
      databaseId: env("NOTION_INBOX_DATABASE_ID") || "5ad118591bcd4e7bbed8b5afd988c42e",
      titleProp: "標題",
      textProps: ["摘要", "原始內容"],
      dateProp: "偵測期限",
      statusProp: "處理狀態",
      typeProp: "分類",
      priorityProp: "重要度",
      closedStatuses: ["已歸檔", "略過"],
    },
    {
      label: "Projects 專案",
      databaseId: env("NOTION_PROJECTS_DATABASE_ID") || "c57faf0cad674051a1643b184b0bcc92",
      titleProp: "專案名稱",
      textProps: ["摘要", "下一步", "客戶", "供應商", "備註"],
      dateProp: "目標日",
      statusProp: "狀態",
      priorityProp: "優先度",
      closedStatuses: ["完成", "取消"],
    },
    {
      label: "Tasks 任務",
      databaseId: env("NOTION_TASKS_DATABASE_ID") || "5d2615b60bb4425698f6dbdac88604e7",
      titleProp: "任務名稱",
      textProps: ["備註", "等待對象"],
      dateProp: "期限",
      statusProp: "狀態",
      priorityProp: "優先度",
      closedStatuses: ["完成", "取消"],
    },
    {
      label: "Knowledge 知識紀錄",
      databaseId: env("NOTION_KNOWLEDGE_DATABASE_ID") || "b9dbd4c4632b4f1c8f112637b497dc67",
      titleProp: "標題",
      textProps: ["摘要", "原文"],
      dateProp: "日期",
      typeProp: "類型",
      priorityProp: "重要度",
    },
    {
      label: "Documents 文件",
      databaseId: env("NOTION_DOCUMENTS_DATABASE_ID") || "1597be16acb64bd698d2642d5f068f9a",
      titleProp: "文件名稱",
      textProps: ["摘要"],
      urlProps: ["來源URL"],
      dateProp: "關鍵日期",
      statusProp: "狀態",
      typeProp: "文件類型",
      closedStatuses: [],
    },
  ];
}

function selectValue(page: NotionPage, propertyName?: string) {
  return propertyName ? page.properties?.[propertyName]?.select?.name as string | undefined : undefined;
}

function statusOrSelectValue(page: NotionPage, propertyName?: string) {
  if (!propertyName) return undefined;
  const property = page.properties?.[propertyName];
  return property?.status?.name as string | undefined ?? property?.select?.name as string | undefined;
}

function dateValue(page: NotionPage, propertyName?: string) {
  return propertyName ? page.properties?.[propertyName]?.date?.start as string | undefined : undefined;
}

function richTextValue(page: NotionPage, propertyName: string) {
  return textFromRichText(page.properties?.[propertyName]?.rich_text);
}

function urlValue(page: NotionPage, propertyName: string) {
  return page.properties?.[propertyName]?.url as string | undefined;
}

function numberValue(page: NotionPage, propertyName: string) {
  const value = page.properties?.[propertyName]?.number;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatProjectMoney(value: number | undefined) {
  return value == null ? "未填" : `NT$${Math.round(value).toLocaleString("zh-TW")}`;
}

function pageTitleForConfig(page: NotionPage, config: SearchDatabaseConfig) {
  return textFromTitle(page.properties?.[config.titleProp]?.title);
}

function pageSummaryForConfig(page: NotionPage, config: SearchDatabaseConfig) {
  for (const propertyName of config.textProps) {
    const value = richTextValue(page, propertyName);
    if (value) return value;
  }
  for (const propertyName of config.urlProps ?? []) {
    const value = urlValue(page, propertyName);
    if (value) return value;
  }
  return "";
}

function andFilter(filters: Record<string, any>[]) {
  return filters.length === 1 ? filters[0] : { and: filters };
}

function openDatabaseFilters(config: SearchDatabaseConfig) {
  return (config.closedStatuses ?? []).map((status) => ({
    property: config.statusProp,
    select: { does_not_equal: status },
  })).filter((filter) => filter.property);
}

function keywordFilterForConfig(config: SearchDatabaseConfig, keyword: string) {
  const terms = expandSearchTerms(keyword);
  const keywordFilters = terms.flatMap((term) => [
    { property: config.titleProp, title: { contains: term } },
    ...config.textProps.map((propertyName) => ({ property: propertyName, rich_text: { contains: term } })),
    ...(config.urlProps ?? []).map((propertyName) => ({ property: propertyName, url: { contains: term } })),
  ]);
  return andFilter([
    ...openDatabaseFilters(config),
    { or: keywordFilters },
  ]);
}

function uniqueValues(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function expandSearchTerms(question: string) {
  const compact = question
    .replace(/^查詢|^查|^找|^搜尋|有沒有|什麼時候|目前|相關|資料|內容|紀錄|記錄/g, " ")
    .replace(/[，,。！？?、/\\|()[\]{}:：;；]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const baseTerms = compact ? compact.split(" ") : [question.trim()];
  const terms = [...baseTerms, compact];

  for (const term of baseTerms) {
    if (/^[\u4e00-\u9fff]{4,}$/.test(term)) {
      terms.push(term.slice(0, 2), term.slice(0, 3), term.slice(-2), term.slice(-3));
    }
  }

  const synonymGroups = [
    ["車險", "汽車保險", "保單", "強制險", "任意險", "保險"],
    ["合約", "契約", "合同"],
    ["報價", "quote", "quotation", "估價", "價格"],
    ["發票", "invoice", "收據"],
    ["摩寶智販機", "摩寶", "智販機", "販賣機"],
  ];

  for (const group of synonymGroups) {
    if (group.some((word) => question.includes(word))) {
      terms.push(...group);
    }
  }

  return uniqueValues(terms).slice(0, 12);
}

function dateFilterForConfig(config: SearchDatabaseConfig, targetDate: string) {
  if (!config.dateProp) return undefined;
  return andFilter([
    ...openDatabaseFilters(config),
    { property: config.dateProp, date: { on_or_before: targetDate } },
  ]);
}

function pendingFilterForConfig(config: SearchDatabaseConfig) {
  if (!config.statusProp) return undefined;
  const pendingTermsByDatabase: Record<string, string[]> = {
    "Inbox 收件箱": ["需要確認", "待整理"],
    "Projects 專案": ["需要確認", "等待他人", "等待中", "待辦", "進行中", "待整理"],
    "Tasks 任務": ["需要確認", "等待他人", "等待中", "待辦", "進行中", "待整理"],
    "Documents 文件": ["需要確認", "待整理", "已摘要"],
  };
  const pendingTerms = pendingTermsByDatabase[config.label] ?? [];
  if (!pendingTerms.length) return undefined;
  return andFilter([
    ...openDatabaseFilters(config),
    { or: pendingTerms.map((status) => ({ property: config.statusProp, select: { equals: status } })) },
  ]);
}

function documentFilterForConfig(config: SearchDatabaseConfig) {
  if (config.label === "Documents 文件") {
    return andFilter([
      ...openDatabaseFilters(config),
      { property: config.titleProp, title: { is_not_empty: true } },
    ]);
  }
  if (!config.typeProp) return undefined;
  return andFilter([
    ...openDatabaseFilters(config),
    { property: config.typeProp, select: { equals: "文件" } },
  ]);
}

function askMultiDatabasePlan(question: string) {
  const today = taipeiDateText();
  const weekEnd = addDaysText(today, 7);
  const configs = databaseConfigs();

  if (includesAny(question, ["今天", "今日", "today"])) {
    return {
      label: `今天 ${today} 到期或逾期的資料`,
      filters: configs.map((config) => ({ config, filter: dateFilterForConfig(config, today) })).filter((item) => item.filter),
    };
  }

  if (includesAny(question, ["這週", "本週", "這周", "本周", "week"])) {
    return {
      label: `這週（到 ${weekEnd}）要追蹤的資料`,
      filters: configs.map((config) => ({ config, filter: dateFilterForConfig(config, weekEnd) })).filter((item) => item.filter),
    };
  }

  if (includesAny(question, ["待確認", "需要確認", "確認", "待辦", "要做"])) {
    return {
      label: "待確認或待處理的資料",
      filters: configs.map((config) => ({ config, filter: pendingFilterForConfig(config) })).filter((item) => item.filter),
    };
  }

  if (includesAny(question, ["文件", "合約", "保單", "發票", "檔案", "pdf"])) {
    const keyword = question.replace(/^文件|文件$/g, "").trim();
    return {
      label: keyword ? `與「${keyword}」相關的文件與記憶` : "文件相關資料",
      filters: configs.map((config) => ({
        config,
        filter: keyword ? keywordFilterForConfig(config, keyword) : documentFilterForConfig(config),
      })).filter((item) => item.filter),
    };
  }

  const keyword = question.trim();
  return {
    label: `與「${keyword}」相關的資料`,
    filters: configs.map((config) => ({ config, filter: keywordFilterForConfig(config, keyword) })),
  };
}

async function queryDatabaseItems(config: SearchDatabaseConfig, filter: Record<string, any>, pageSize = 5) {
  const token = env("NOTION_TOKEN");
  if (!token) throw new Error("Missing NOTION_TOKEN");

  const response = await fetch(`https://api.notion.com/v1/databases/${config.databaseId}/query`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({
      page_size: pageSize,
      filter,
      sorts: [{ timestamp: "created_time", direction: "descending" }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${config.label}: ${response.status} ${body.slice(0, 300)}`);
  }

  const data = await response.json() as { results?: NotionPage[] };
  return data.results ?? [];
}

function formatDatabaseSection(config: SearchDatabaseConfig, pages: NotionPage[]) {
  if (!pages.length) return "";
  const lines = pages.map((page, index) => {
    const title = pageTitleForConfig(page, config);
    const date = dateValue(page, config.dateProp);
    const type = selectValue(page, config.typeProp);
    const priority = selectValue(page, config.priorityProp);
    const status = statusOrSelectValue(page, config.statusProp);
    const summary = pageSummaryForConfig(page, config);
    const meta = [
      date ? `日期：${date}` : "",
      type ? `類型：${type}` : "",
      priority ? `重要度：${priority}` : "",
      status ? `狀態：${status}` : "",
    ].filter(Boolean).join(" / ");
    return [
      `${index + 1}. ${title}`,
      meta ? `   ${meta}` : "",
      summary ? `   ${summary.slice(0, 120)}` : "",
      page.url ? `   ${page.url}` : "",
    ].filter(Boolean).join("\n");
  });
  return [`【${config.label}】`, ...lines].join("\n");
}

function projectConfig() {
  return databaseConfigs().find((config) => config.label === "Projects 專案");
}

function taskConfig() {
  return databaseConfigs().find((config) => config.label === "Tasks 任務");
}

function isTaskQuestion(question: string) {
  const normalized = question.toLowerCase();
  return ["待辦", "任務", "要做", "todo", "to-do", "task"].some((term) => normalized.includes(term));
}

function isOpenTask(page: NotionPage) {
  const status = statusOrSelectValue(page, "狀態");
  return !["完成", "取消", "已完成", "已取消"].includes(status ?? "");
}

function formatTaskSection(question: string, pages: NotionPage[]) {
  const config = taskConfig();
  const openPages = pages.filter(isOpenTask).slice(0, 10);
  if (!openPages.length) {
    return [
      `查詢：${question}`,
      "",
      "目前沒有找到尚未完成的待辦事項。",
    ].join("\n");
  }

  const lines = openPages.map((page, index) => {
    const title = config ? pageTitleForConfig(page, config) : "未命名";
    const dueDate = dateValue(page, "期限");
    const status = statusOrSelectValue(page, "狀態") || "未設定";
    const priority = selectValue(page, "優先度");
    const waitingFor = richTextValue(page, "等待對象");
    const note = richTextValue(page, "備註");
    const meta = [
      dueDate ? `期限：${dueDate}` : "",
      `狀態：${status}`,
      priority ? `優先度：${priority}` : "",
      waitingFor ? `等待：${waitingFor}` : "",
    ].filter(Boolean).join(" / ");

    return [
      `${index + 1}. ${title}`,
      meta ? `   ${meta}` : "",
      note ? `   ${note.slice(0, 100)}` : "",
      page.url ? `   ${page.url}` : "",
    ].filter(Boolean).join("\n");
  });

  return [
    `查詢：${question}`,
    "",
    "【Tasks 待辦事項】",
    ...lines,
  ].join("\n");
}

async function handleTaskQuery(question: string) {
  if (!isTaskQuestion(question)) return null;
  const config = taskConfig();
  if (!config) return null;
  const pages = await queryDatabaseItems(
    config,
    { property: config.titleProp, title: { is_not_empty: true } },
    25,
  );
  return formatTaskSection(question, pages);
}

function isProjectBusinessQuestion(question: string) {
  const normalized = question.toLowerCase();
  return [
    "毛利",
    "售價",
    "成本",
    "forecast",
    "預測",
    "客戶",
    "供應商",
    "商務",
    "報價",
    "價格",
    "營收",
    "利潤",
  ].some((term) => normalized.includes(term));
}

function formatProjectBusinessSection(question: string, pages: NotionPage[]) {
  if (!pages.length) {
    return [
      `查詢：${question}`,
      "",
      "目前沒有找到未完成專案的商務資料。",
    ].join("\n");
  }

  const lines = pages.map((page, index) => {
    const config = projectConfig();
    const title = config ? pageTitleForConfig(page, config) : "未命名";
    const price = numberValue(page, "售價");
    const cost = numberValue(page, "成本");
    const margin = numberValue(page, "毛利");
    const forecast = numberValue(page, "Forecast");
    const calculatedMargin = margin ?? (
      price != null && cost != null ? price - cost : undefined
    );
    const marginText = margin == null && calculatedMargin != null
      ? `${formatProjectMoney(calculatedMargin)}（售價 - 成本）`
      : formatProjectMoney(margin);
    const meta = [
      `客戶：${richTextValue(page, "客戶") || "未填"}`,
      `供應商：${richTextValue(page, "供應商") || "未填"}`,
      `售價：${formatProjectMoney(price)}`,
      `成本：${formatProjectMoney(cost)}`,
      `毛利：${marginText}`,
      `Forecast：${formatProjectMoney(forecast)}`,
      `狀態：${selectValue(page, "狀態") || "未設定"}`,
    ];
    const note = richTextValue(page, "備註");

    return [
      `${index + 1}. ${title}`,
      `   ${meta.join(" / ")}`,
      note ? `   備註：${note.slice(0, 100)}` : "",
      page.url ? `   ${page.url}` : "",
    ].filter(Boolean).join("\n");
  });

  return [
    `查詢：${question}`,
    "",
    "【Projects 專案商務資料】",
    ...lines,
  ].join("\n");
}

async function handleProjectBusinessQuery(question: string) {
  if (!isProjectBusinessQuestion(question)) return null;
  const config = projectConfig();
  if (!config) return null;
  const filters = openDatabaseFilters(config);
  const pages = await queryDatabaseItems(config, andFilter(filters), 10);
  return formatProjectBusinessSection(question, pages);
}

function anyTitleFromPage(page: NotionPage) {
  const properties = page.properties ?? {};
  for (const value of Object.values(properties)) {
    if (value?.type === "title" || value?.title) {
      const title = textFromTitle(value.title);
      if (title && title !== "\u672a\u547d\u540d") return title;
    }
  }
  const title = (page as any).title;
  if (Array.isArray(title)) return textFromTitle(title);
  return "\u672a\u547d\u540d";
}

async function queryNotionGlobalSearch(question: string) {
  const token = env("NOTION_TOKEN");
  if (!token) throw new Error("Missing NOTION_TOKEN");

  const terms = expandSearchTerms(question).slice(0, 5);
  const results: NotionPage[] = [];
  const seen = new Set<string>();

  for (const term of terms) {
    const response = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify({
        query: term,
        page_size: 5,
        filter: { property: "object", value: "page" },
        sort: { direction: "descending", timestamp: "last_edited_time" },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Notion search: ${response.status} ${body.slice(0, 300)}`);
    }

    const data = await response.json() as { results?: NotionPage[] };
    for (const page of data.results ?? []) {
      const key = page.url ?? JSON.stringify(page.properties ?? {}).slice(0, 120);
      if (!seen.has(key)) {
        seen.add(key);
        results.push(page);
      }
    }
  }

  return results.slice(0, 8);
}

function formatGlobalSearchSection(pages: NotionPage[]) {
  if (!pages.length) return "";
  const lines = pages.map((page, index) => [
    `${index + 1}. ${anyTitleFromPage(page)}`,
    page.url ? `   ${page.url}` : "",
  ].filter(Boolean).join("\n"));
  return ["【Notion 全域補查】", ...lines].join("\n");
}

function formatMultiDatabaseResults(
  label: string,
  results: Array<{ config: SearchDatabaseConfig; pages: NotionPage[]; error?: string }>,
  globalPages: NotionPage[] = [],
) {
  const sections = results
    .map(({ config, pages }) => formatDatabaseSection(config, pages))
    .filter(Boolean);
  const globalSection = formatGlobalSearchSection(globalPages);
  if (globalSection) sections.push(globalSection);
  const errors = results.filter((result) => result.error);
  const errorSection = errors.length
    ? [
      "【部分資料庫略過】",
      ...errors.map((result) => `${result.config.label}：${result.error}`),
    ].join("\n")
    : "";
  if (errorSection) sections.push(errorSection);

  if (!sections.length) {
    return [label, "", "目前沒有在任何資料庫找到符合條件的資料。"].join("\n");
  }

  return [label, "", ...sections].join("\n\n");
}

async function handleAskCommand(text: string) {
  const question = trimCommand(text, "/ask");
  if (!question) {
    return [
      "\u683c\u5f0f\uff1a/ask <\u60f3\u67e5\u7684\u4e8b>",
      "",
      "\u4f8b\uff1a/ask \u4eca\u5929\u8981\u505a\u4ec0\u9ebc",
      "\u4f8b\uff1a/ask \u9019\u9031\u8981\u8ffd\u8e64\u4ec0\u9ebc",
      "\u4f8b\uff1a/ask \u6469\u5bf6\u667a\u8ca9\u6a5f",
      "\u4f8b\uff1a/ask \u6bdb\u5229",
      "\u4f8b\uff1a/ask \u5f85\u8fa6\u4e8b\u9805",
      "\u4f8b\uff1a/ask \u5f85\u78ba\u8a8d",
      "\u4f8b\uff1a/ask \u6587\u4ef6",
      "\u4f8b\uff1a/ask \u8eca\u96aa",
    ].join("\n");
  }

  const taskReply = await handleTaskQuery(question);
  if (taskReply) return taskReply;

  const projectBusinessReply = await handleProjectBusinessQuery(question);
  if (projectBusinessReply) return projectBusinessReply;

  const { label, filters } = askMultiDatabasePlan(question);
  const results = await Promise.all(
    filters.map(async ({ config, filter }) => {
      try {
        return {
          config,
          pages: await queryDatabaseItems(config, filter as Record<string, any>),
        };
      } catch (error) {
        return {
          config,
          pages: [],
          error: String(error).slice(0, 160),
        };
      }
    }),
  );
  const resultCount = results.reduce((count, result) => count + result.pages.length, 0);
  const globalPages = resultCount < 5 ? await queryNotionGlobalSearch(question) : [];
  return formatMultiDatabaseResults(label, results, globalPages);
}

function targetTextForError(route: { name: string; url?: string }, text: string) {
  if (text.startsWith("/mem")) return "Notion Inbox";
  if (text.startsWith("/ask")) return "Notion Inbox";
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

  if (text.startsWith("/chatid")) {
    await sendTelegramMessage(
      chatId,
      [
        "\u9019\u500b Telegram \u804a\u5929\u7684 ID \u662f\uff1a",
        "",
        String(chatId),
        "",
        "\u8acb\u628a\u9019\u500b\u503c\u586b\u5230 Netlify Environment variable\uff1aTELEGRAM_REMINDER_CHAT_ID",
      ].join("\n"),
    );
    return Response.json({ ok: true, routed: "chat-id" });
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

    if (text.startsWith("/ask")) {
      const reply = await handleAskCommand(text);
      await sendTelegramMessage(chatId, reply);
      return Response.json({ ok: true, routed: "notion-query" });
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
