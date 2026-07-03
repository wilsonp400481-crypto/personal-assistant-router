import type { Config } from "@netlify/functions";

declare const Netlify: {
  env: {
    get(name: string): string | undefined;
  };
};

type NotionTextValue = {
  plain_text?: string;
};

type NotionPage = {
  url?: string;
  properties?: Record<string, any>;
};

function env(name: string) {
  return Netlify.env.get(name);
}

function taipeiDateText() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
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
  return textFromRichText(page.properties?.["\u6458\u8981"]?.rich_text);
}

function pageSelect(page: NotionPage, propertyName: string) {
  return page.properties?.[propertyName]?.select?.name as string | undefined;
}

function pageDate(page: NotionPage) {
  return page.properties?.["\u5075\u6e2c\u671f\u9650"]?.date?.start as string | undefined;
}

async function sendTelegramMessage(chatId: string, text: string) {
  const token = env("TELEGRAM_BOT_TOKEN");
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

async function queryDueInboxItems(today: string) {
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
      page_size: 20,
      filter: {
        and: [
          { property: "\u5075\u6e2c\u671f\u9650", date: { on_or_before: today } },
          { property: "\u8655\u7406\u72c0\u614b", select: { does_not_equal: "\u5df2\u6b78\u6a94" } },
          { property: "\u8655\u7406\u72c0\u614b", select: { does_not_equal: "\u7565\u904e" } },
        ],
      },
      sorts: [
        { property: "\u5075\u6e2c\u671f\u9650", direction: "ascending" },
        { timestamp: "created_time", direction: "ascending" },
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

function formatReminderMessage(today: string, pages: NotionPage[]) {
  if (!pages.length) {
    return `\u4eca\u5929 ${today} \u6c92\u6709\u5230\u671f\u6216\u903e\u671f\u7684\u8a18\u61b6\u4e8b\u9805\u3002`;
  }

  const lines = pages.map((page, index) => {
    const title = pageTitle(page);
    const date = pageDate(page) ?? "\u672a\u8a2d\u5b9a";
    const category = pageSelect(page, "\u5206\u985e") ?? "\u672a\u5206\u985e";
    const priority = pageSelect(page, "\u91cd\u8981\u5ea6") ?? "\u672a\u8a2d\u5b9a";
    const summary = pageSummary(page);
    return [
      `${index + 1}. ${title}`,
      `   \u671f\u9650\uff1a${date} / \u5206\u985e\uff1a${category} / \u91cd\u8981\u5ea6\uff1a${priority}`,
      summary ? `   ${summary}` : "",
      page.url ? `   ${page.url}` : "",
    ].filter(Boolean).join("\n");
  });

  return [
    `\u4eca\u5929 ${today} \u7684\u8a18\u61b6\u63d0\u9192`,
    "",
    ...lines,
  ].join("\n\n");
}

export default async () => {
  const chatId = env("TELEGRAM_REMINDER_CHAT_ID");
  if (!chatId) throw new Error("Missing TELEGRAM_REMINDER_CHAT_ID");

  const today = taipeiDateText();
  const pages = await queryDueInboxItems(today);
  await sendTelegramMessage(chatId, formatReminderMessage(today, pages));

  return Response.json({ ok: true, date: today, count: pages.length });
};

export const config: Config = {
  schedule: "0 1 * * *",
};
