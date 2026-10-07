import { updateMailTokens, type MailConnectionForSync } from "@autoapply/database";
import { AuthorizedClient } from "./auth";
import type { FetchLike } from "./http";
import { providerEndpoints } from "./oauth";
import { GoogleMailClient } from "./providers/google";
import { MicrosoftMailClient } from "./providers/microsoft";
import type { CalendarClient, MailClient } from "./types";

export interface ClientOptions {
  fetch?: FetchLike;
  env?: Record<string, string | undefined>;
}

/** Mail and calendar API clients for a saved connection; refreshed tokens are saved back. */
export function createProviderClient(connection: MailConnectionForSync, options: ClientOptions = {}): MailClient & CalendarClient {
  const env = options.env ?? process.env;
  const http = new AuthorizedClient(
    { provider: connection.provider, accessToken: connection.accessToken, refreshToken: connection.refreshToken, tokenExpiresAt: connection.tokenExpiresAt },
    options.fetch ?? fetch,
    (tokens) => updateMailTokens(connection.id, tokens),
    env,
  );
  const endpoints = providerEndpoints(connection.provider, env);
  return connection.provider === "GOOGLE" ? new GoogleMailClient(http, endpoints) : new MicrosoftMailClient(http, endpoints);
}
