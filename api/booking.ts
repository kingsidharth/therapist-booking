import { createProductionApp } from "../apps/server/src/production";

let application: ReturnType<typeof createProductionApp> | undefined;

function getApplication() {
  if (application) return application;
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  const adminKey = process.env.ADMIN_KEY?.trim();
  if (!url || !authToken || !adminKey || !["libsql:", "https:"].includes(new URL(url).protocol)) {
    throw new Error("Incomplete production configuration.");
  }
  application = createProductionApp({ url, authToken, adminKey }).catch(error => {
    application = undefined;
    throw error;
  });
  return application;
}

export default {
  async fetch(request: Request) {
    try {
      const app = await getApplication();
      return await app.fetch(request);
    } catch {
      // Connection errors may contain database credentials or URLs.
      console.error("The booking API could not serve this request.");
      return Response.json(
        { error: { code: "INVALID_STATE", message: "The booking service is temporarily unavailable." } },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  },
};
