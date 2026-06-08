import type { Config } from "@netlify/functions";

declare const Netlify: {
  env: {
    get(name: string): string | undefined;
  };
};

function normalizeBaseUrl(value: string | undefined) {
  return (value ?? "").replace(/\/+$/, "");
}

export default async () => {
  return Response.json({
    billAssistantUrl: normalizeBaseUrl(Netlify.env.get("BILL_ASSISTANT_URL")),
    investAssistantUrl: normalizeBaseUrl(Netlify.env.get("INVEST_ASSISTANT_URL")),
  });
};

export const config: Config = {
  path: "/api/app-links",
  method: ["GET"],
};
