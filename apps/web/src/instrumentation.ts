import type { Instrumentation } from "next";

/**
 * Runs once when the server starts: check the configuration before taking
 * traffic (in production a broken or insecure configuration stops the
 * server), then turn on server-side error reporting (see packages/ops). Only
 * the Node.js runtime does either; the edge proxy has nothing worth reporting.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkEnvironment, createLogger } = await import("@autoapply/shared");
  const log = createLogger("web");
  const { errors, warnings } = checkEnvironment(process.env, "web");
  for (const warning of warnings) log.warn(warning);
  if (errors.length) {
    for (const error of errors) log.error(error);
    throw new Error(`Applyance can't start: ${errors.join(" ")}`);
  }
  const { initErrorReporting } = await import("@autoapply/ops");
  initErrorReporting("web");
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { captureException } = await import("@autoapply/ops");
  // The route pattern, never the actual path or query, which can hold ids and search terms.
  captureException(error, {
    tags: { route: context.routePath, routeType: context.routeType, method: request.method },
    extra: { digest: (error as { digest?: string }).digest },
  });
};
