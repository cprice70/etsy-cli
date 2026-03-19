import { saveConfig, type Config } from "./config.js";

const BASE_URL = "https://openapi.etsy.com/v3";
const TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
const REFRESH_THRESHOLD_SECONDS = 60;

interface CallOptions {
  query?: Record<string, string>;
  body?: unknown;
  oauth?: boolean;
}

export class EtsyClient {
  private config: Partial<Config>;

  constructor(config: Partial<Config>) {
    this.config = config;
  }

  async call(method: string, path: string, options: CallOptions = {}): Promise<unknown> {
    if (options.oauth && !this.config.accessToken) {
      throw new Error(
        "This command requires OAuth. Run `etsy auth login` and complete the OAuth step."
      );
    }

    // Proactive refresh: if expiresAt known and within threshold
    if (
      this.config.accessToken &&
      this.config.accessTokenExpiresAt !== undefined &&
      !process.env.ETSY_ACCESS_TOKEN // skip if env-var-supplied
    ) {
      const secondsUntilExpiry = this.config.accessTokenExpiresAt - Math.floor(Date.now() / 1000);
      if (secondsUntilExpiry < REFRESH_THRESHOLD_SECONDS) {
        await this.doRefresh();
      }
    }

    const response = await this.makeRequest(method, path, options);

    // Reactive refresh on 401
    if (response.status === 401 && this.config.refreshToken) {
      await this.doRefresh();
      const retryResponse = await this.makeRequest(method, path, options);
      return this.handleResponse(retryResponse);
    }

    return this.handleResponse(response);
  }

  private async makeRequest(method: string, path: string, options: CallOptions): Promise<Response> {
    const url = new URL(`${BASE_URL}${path}`);
    if (options.query) {
      for (const [k, v] of Object.entries(options.query)) {
        url.searchParams.set(k, v);
      }
    }

    const headers: Record<string, string> = {};

    if (this.config.accessToken) {
      headers["Authorization"] = `Bearer ${this.config.accessToken}`;
    } else if (this.config.apiKey) {
      headers["x-api-key"] = this.config.apiKey;
    }

    const init: RequestInit = { method, headers };

    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }

    return fetch(url.toString(), init);
  }

  private async handleResponse(response: Response): Promise<unknown> {
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const body = await response.json() as Record<string, unknown>;
        if (body.error) message += `: ${body.error}`;
        else if (body.message) message += `: ${body.message}`;
      } catch {
        // ignore parse errors
      }
      throw new Error(message);
    }
    return response.json();
  }

  private async doRefresh(): Promise<void> {
    if (!this.config.refreshToken || !this.config.clientId) {
      throw new Error("Cannot refresh: missing refresh token or client ID. Run `etsy auth login`.");
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.config.clientId,
      refresh_token: this.config.refreshToken,
    });

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error("Token refresh failed. Run `etsy auth login` to re-authenticate.");
    }

    const tokens = await response.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    this.config.accessToken = tokens.access_token;
    this.config.refreshToken = tokens.refresh_token;
    this.config.accessTokenExpiresAt = Math.floor(Date.now() / 1000) + tokens.expires_in;

    saveConfig(this.config);
  }
}

export function createClient(config: Partial<Config>): EtsyClient {
  return new EtsyClient(config);
}
