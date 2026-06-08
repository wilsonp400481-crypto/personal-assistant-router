# Personal Assistant Router

Telegram can only use one webhook URL per bot. This project is the central router.

## Routes

- `/bill` uses the bill assistant API and replies from this router
- `/invest` forwards to `INVEST_ASSISTANT_URL` plus `INVEST_ASSISTANT_WEBHOOK_PATH`
- `/help` is handled by this router

## Netlify Environment Variables

```text
TELEGRAM_BOT_TOKEN
BILL_ASSISTANT_URL
INVEST_ASSISTANT_URL
INVEST_ASSISTANT_WEBHOOK_PATH
```

Example:

```text
BILL_ASSISTANT_URL=https://your-bill-assistant.netlify.app
INVEST_ASSISTANT_URL=https://your-invest-assistant.netlify.app
INVEST_ASSISTANT_WEBHOOK_PATH=/.netlify/functions/amber-telegram
```

## Telegram Webhook

After deploying this router, set the Telegram webhook to:

```text
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=https://YOUR_ROUTER_SITE.netlify.app/api/telegram-router
```
