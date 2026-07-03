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
  id: string;
  url?: string;
  properties?: Record<string, any>;
};

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleCalendarEvent = {
  id?: string;
  summary: string;
  description?: string;
  start: { date?: string; dateTime?: string; timeZone?: string };
  end: { date?: string; dateTime?: string; timeZone?: string };
  source?: { title: string; url: string };
};

const TIME_ZONE = "Asia/Taipei";
const DONE_STATUSES = ["完成", "取消", "已完成", "已取消"];

function env(name: string) {
  return Netlify.env.get(name);
}

function textFromTitle(value: NotionTextValue[] | undefined) {
  return value?.map((item) => item.plain_text ?? "").join("").trim() || "未命名任務";
}

function textFromRichText(value: NotionTextValue[] | undefined) {
  return value?.map((item) => item.plain_text ?? "").join("").trim() || "";
}

function richText(content: string) {
  return content ? [{ type: "text", text: { content: content.slice(0, 2000) } }] : [];
}

function taskTitle(page: NotionPage) {
  return textFromTitle(page.properties?.["任務名稱"]?.title);
}

function taskNote(page: NotionPage) {
  return textFromRichText(page.properties?.["備註"]?.rich_text);
}

function taskStatus(page: NotionPage) {
  const property = page.properties?.["狀態"];
  return property?.select?.name as string | undefined ?? property?.status?.name as string | undefined ?? "";
}

function taskDueDate(page: NotionPage) {
  return page.properties?.["期限"]?.date as { start?: string; end?: string } | undefined;
}

function taskEventId(page: NotionPage) {
  return textFromRichText(page.properties?.["Google Calendar Event ID"]?.rich_text);
}

function shouldSync(page: NotionPage) {
  return page.properties?.["同步到日曆"]?.checkbox === true;
}

function isDone(page: NotionPage) {
  return DONE_STATUSES.includes(taskStatus(page));
}

function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addHours(dateTime: string, hours: number) {
  const date = new Date(dateTime);
  date.setHours(date.getHours() + hours);
  return date.toISOString();
}

function eventTimeFromDueDate(page: NotionPage) {
  const dueDate = taskDueDate(page);
  const start = dueDate?.start;
  if (!start) return null;

  const end = dueDate.end;
  if (start.includes("T")) {
    return {
      start: { dateTime: start, timeZone: TIME_ZONE },
      end: { dateTime: end ?? addHours(start, 1), timeZone: TIME_ZONE },
    };
  }

  return {
    start: { date: start },
    end: { date: end ?? addDays(start, 1) },
  };
}

function calendarEventFromTask(page: NotionPage): GoogleCalendarEvent | null {
  const time = eventTimeFromDueDate(page);
  if (!time) return null;

  const note = taskNote(page);
  const description = [
    note,
    page.url ? `Notion: ${page.url}` : "",
  ].filter(Boolean).join("\n\n");

  return {
    summary: taskTitle(page),
    description,
    start: time.start,
    end: time.end,
    ...(page.url ? { source: { title: "Notion Task", url: page.url } } : {}),
  };
}

async function notionRequest(path: string, init: RequestInit = {}) {
  const token = env("NOTION_TOKEN");
  if (!token) throw new Error("Missing NOTION_TOKEN");

  const response = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Notion ${response.status} ${body.slice(0, 500)}`);
  }

  return response.json();
}

async function queryCalendarTasks() {
  const databaseId = env("NOTION_TASKS_DATABASE_ID");
  if (!databaseId) throw new Error("Missing NOTION_TASKS_DATABASE_ID");

  const data = await notionRequest(`/databases/${databaseId}/query`, {
    method: "POST",
    body: JSON.stringify({
      page_size: 50,
      filter: {
        or: [
          { property: "同步到日曆", checkbox: { equals: true } },
          { property: "Google Calendar Event ID", rich_text: { is_not_empty: true } },
        ],
      },
      sorts: [
        { property: "期限", direction: "ascending" },
        { timestamp: "last_edited_time", direction: "descending" },
      ],
    }),
  }) as { results?: NotionPage[] };

  return data.results ?? [];
}

async function updateTaskSyncState(
  page: NotionPage,
  status: "未同步" | "已同步" | "已取消" | "同步失敗",
  eventId = "",
  error = "",
) {
  await notionRequest(`/pages/${page.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        "Google Calendar Event ID": { rich_text: richText(eventId) },
        "日曆同步狀態": { select: { name: status } },
        "上次日曆同步時間": { date: { start: new Date().toISOString() } },
        "日曆同步錯誤": { rich_text: richText(error) },
      },
    }),
  });
}

async function googleAccessToken() {
  const clientId = env("GOOGLE_CLIENT_ID");
  const clientSecret = env("GOOGLE_CLIENT_SECRET");
  const refreshToken = env("GOOGLE_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) return "";

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await response.json() as GoogleTokenResponse;
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Google token failed");
  }
  return data.access_token;
}

async function googleCalendarRequest(
  accessToken: string,
  path: string,
  init: RequestInit = {},
  okStatuses = [200, 201, 204],
) {
  const calendarId = encodeURIComponent(env("GOOGLE_CALENDAR_ID") || "primary");
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!okStatuses.includes(response.status)) {
    const body = await response.text();
    throw new Error(`Google Calendar ${response.status} ${body.slice(0, 500)}`);
  }

  if (response.status === 204) return {};
  return response.json();
}

async function upsertCalendarEvent(accessToken: string, page: NotionPage) {
  const event = calendarEventFromTask(page);
  if (!event) {
    await updateTaskSyncState(page, "同步失敗", taskEventId(page), "任務沒有期限，無法同步到日曆。");
    return "missing-date";
  }

  const eventId = taskEventId(page);
  if (eventId) {
    await googleCalendarRequest(accessToken, `/events/${encodeURIComponent(eventId)}`, {
      method: "PATCH",
      body: JSON.stringify(event),
    });
    await updateTaskSyncState(page, "已同步", eventId);
    return "updated";
  }

  const created = await googleCalendarRequest(accessToken, "/events", {
    method: "POST",
    body: JSON.stringify(event),
  }) as { id?: string };
  await updateTaskSyncState(page, "已同步", created.id ?? "");
  return "created";
}

async function cancelCalendarEvent(accessToken: string, page: NotionPage) {
  const eventId = taskEventId(page);
  if (!eventId) {
    await updateTaskSyncState(page, "已取消");
    return "already-empty";
  }

  await googleCalendarRequest(
    accessToken,
    `/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
    [200, 204, 404, 410],
  );
  await updateTaskSyncState(page, "已取消");
  return "cancelled";
}

export default async () => {
  const accessToken = await googleAccessToken();
  if (!accessToken) {
    return Response.json({
      ok: true,
      configured: false,
      message: "Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REFRESH_TOKEN.",
    });
  }

  const tasks = await queryCalendarTasks();
  const stats: Record<string, number> = {};

  for (const task of tasks) {
    try {
      const action = !shouldSync(task) || isDone(task)
        ? await cancelCalendarEvent(accessToken, task)
        : await upsertCalendarEvent(accessToken, task);
      stats[action] = (stats[action] ?? 0) + 1;
    } catch (error) {
      await updateTaskSyncState(task, "同步失敗", taskEventId(task), String(error).slice(0, 300));
      stats.failed = (stats.failed ?? 0) + 1;
    }
  }

  return Response.json({ ok: true, configured: true, scanned: tasks.length, stats });
};

export const config: Config = {
  schedule: "*/15 * * * *",
};
