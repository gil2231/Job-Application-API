import { request, ProviderAuthError, type FetchLike } from "./http";
import { oauthApp, refreshAccessToken, type TokenSet } from "./oauth";
import type { MailProviderId } from "./types";

export interface TokenState {
  provider: MailProviderId;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
}

/**
 * Bearer-authorized requests for one connection. Refreshes the access token
 * shortly before it expires, and once more if the API answers 401; saves every
 * new token through `persist`. Throws ProviderAuthError when the account has
 * to be connected again.
 */
export class AuthorizedClient {
  private refreshing: Promise<void> | null = null;

  constructor(
    private readonly state: TokenState,
    private readonly fetchImpl: FetchLike,
    private readonly persist: (tokens: TokenSet) => Promise<void>,
    private readonly env: Record<string, string | undefined> = process.env,
  ) {}

  private async refresh() {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const { app } = oauthApp(this.state.provider, this.env);
        if (!app || !this.state.refreshToken) throw new ProviderAuthError();
        const tokens = await refreshAccessToken(this.state.provider, app, this.state.refreshToken, this.fetchImpl, this.env);
        this.state.accessToken = tokens.accessToken;
        this.state.refreshToken = tokens.refreshToken ?? this.state.refreshToken;
        this.state.tokenExpiresAt = tokens.expiresAt;
        await this.persist(tokens);
      })().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }

  async fetch(url: string, init: RequestInit = {}, label?: string): Promise<Response> {
    const expires = this.state.tokenExpiresAt?.getTime();
    if (expires !== undefined && expires - Date.now() < 120_000) await this.refresh();
    const send = () => request(this.fetchImpl, url, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${this.state.accessToken}` } }, label);
    try {
      return await send();
    } catch (error) {
      if (!(error instanceof ProviderAuthError)) throw error;
      await this.refresh();
      return send();
    }
  }
}
