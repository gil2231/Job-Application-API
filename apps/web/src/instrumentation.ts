import type { Instrumentation } from "next";

/**
 * Server-side error reporting for the web app (see packages/ops). Only the
 * Node.js runtime reports; the edge proxy has nothing worth reporting.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initErrorReporting } = await import("@autoapply/ops");
    initErrorReporting("web");
  }
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
