import { startMockSite } from "./server";

const port = Number(process.env.MOCK_SITE_PORT ?? 4100);
const site = await startMockSite(port, "127.0.0.1");
console.warn(`[mock-site] Mock application pages at ${site.url}/ (local testing only)`);
