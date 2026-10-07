import { existsSync } from "node:fs";
import { resolve } from "node:path";

const rootEnv = resolve(import.meta.dirname, "../../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const { initErrorReporting, installProcessHandlers, flushErrorReports } = await import("@autoapply/ops");
initErrorReporting("api");
installProcessHandlers();

const { buildServer } = await import("./server");
const app = await buildServer();
const port = Number(process.env.API_PORT ?? 4000);

try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app
      .close()
      .then(() => flushErrorReports(2000))
      .then(() => process.exit(0));
  });
}
