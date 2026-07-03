# Personal Assistant Router

Telegram can only use one webhook URL per bot. This project is the central router.

## Routes

- `/bill` uses the bill assistant API and replies from this router
- `/bill rule <name> <next_due_date> <interval_months> [amount]` adds recurring bill rules
- `/invest` forwards to `INVEST_ASSISTANT_URL` plus `INVEST_ASSISTANT_WEBHOOK_PATH`
- `/mem <content>` saves a quick note into the Notion Inbox database and applies lightweight rule-based classification
- `/ask <question>` queries Notion Inbox, Projects, Tasks, Knowledge, and Documents with lightweight rule-based filters
- `/ask 毛利`, `/ask 售價`, `/ask 成本`, and `/ask Forecast` list Projects business fields directly
- `/chatid` replies with the current Telegram chat ID for scheduled reminders
- `/help` is handled by this router

## Netlify Environment Variables

```text
TELEGRAM_BOT_TOKEN
BILL_ASSISTANT_URL
INVEST_ASSISTANT_URL
INVEST_ASSISTANT_WEBHOOK_PATH
NOTION_TOKEN
NOTION_INBOX_DATABASE_ID
NOTION_PROJECTS_DATABASE_ID
NOTION_TASKS_DATABASE_ID
NOTION_KNOWLEDGE_DATABASE_ID
NOTION_DOCUMENTS_DATABASE_ID
TELEGRAM_REMINDER_CHAT_ID
```

Example:

```text
BILL_ASSISTANT_URL=https://your-bill-assistant.netlify.app
INVEST_ASSISTANT_URL=https://your-invest-assistant.netlify.app
INVEST_ASSISTANT_WEBHOOK_PATH=/.netlify/functions/amber-telegram
NOTION_INBOX_DATABASE_ID=5ad118591bcd4e7bbed8b5afd988c42e
NOTION_PROJECTS_DATABASE_ID=c57faf0cad674051a1643b184b0bcc92
NOTION_TASKS_DATABASE_ID=5d2615b60bb4425698f6dbdac88604e7
NOTION_KNOWLEDGE_DATABASE_ID=b9dbd4c4632b4f1c8f112637b497dc67
NOTION_DOCUMENTS_DATABASE_ID=1597be16acb64bd698d2642d5f068f9a
```

`daily-reminder` is a scheduled function that runs at 09:00 Asia/Taipei every day. It queries Notion Inbox items whose `偵測期限` is today or overdue and sends them to `TELEGRAM_REMINDER_CHAT_ID`.

## Telegram Webhook

After deploying this router, set the Telegram webhook to:

```text
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://YOUR_ROUTER_SITE.netlify.app/api/telegram-router
```

Example bill rule command:

```text
/bill rule electricity 2026-07-15 2 1200
```

Example memory command:

```text
/mem 摩寶智販機下週要確認報價，還要問場地方電力規格
```

Memory notes are classified without AI tokens. The router sets Inbox fields such as `分類`, `摘要`, `重要度`, `偵測期限`, and `需要確認` using simple local rules.

Example memory query commands:

```text
/ask 今天要做什麼
/ask 這週要追蹤什麼
/ask 摩寶智販機
/ask 待確認
/ask 文件
/ask 車險
```

`/ask` expands common keywords and synonyms before searching. For example, `車險` also searches terms like `汽車保險`, `保單`, `強制險`, and `任意險`. If database field results are sparse, it also performs a Notion-wide page title search as a fallback.
