/**
 * Runs once when the server starts: check the configuration before taking
 * traffic. In production a broken or insecure configuration stops the server.
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
}
