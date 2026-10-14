import {
  createSupabaseHandler,
  supabaseRpc,
} from "../../server/supabase-api.mjs";
let handler;
export default async (request, context) => {
  if (!handler) {
    try {
      handler = createSupabaseHandler({
        appOrigin: process.env.APP_ORIGIN || process.env.URL,
        couponCode: process.env.SHIGODEKI_COUPON_CODE || "",
        rpc: supabaseRpc({
          url: process.env.SUPABASE_URL,
          key: process.env.SUPABASE_SERVICE_ROLE_KEY,
        }),
      });
    } catch {
      const config = new URL(request.url).pathname.endsWith(
        "/commerce-config.json",
      );
      return Response.json(
        config
          ? { appOrigin: null }
          : {
              error:
                "アプリの受付を準備しています。販売者にお問い合わせください。",
            },
        {
          status: config ? 200 : 503,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
  }
  return handler(request, context);
};
export const config = {
  path: [
    "/api/shigodeki/*",
    "/tools/shigodeki-sensei/commerce-config.json",
    "/healthz",
  ],
};
