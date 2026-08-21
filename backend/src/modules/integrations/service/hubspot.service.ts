import axios from "axios";
import { AppError } from "../../../shared/utils/AppError";

/**
 * Scopes needed to establish a HubSpot connection and sync the limited data
 * set the dashboard relies on: contacts and deals (with deal-stage history).
 */
export const HUBSPOT_SCOPES = [
  "oauth",
  "crm.objects.contacts.read",
  "crm.objects.deals.read"
];

export interface HubSpotTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface HubSpotTokenInfo {
  hubId: string;
  hubDomain: string | null;
  scopes: string[];
}

export interface HubSpotPaginatedResponse<T> {
  results: T[];
  paging?: { next?: { after?: string } };
}

export interface HubSpotContact {
  id: string;
  properties: Record<string, string>;
}

export interface HubSpotDeal {
  id: string;
  properties: Record<string, string>;
  propertiesWithHistory?: {
    dealstage?: { value: string; timestamp: string }[];
  };
}

/**
 * Thin wrapper around HubSpot's OAuth endpoints, mirroring the reference
 * implementation in v1's HubSpotService (connection portion only).
 */
export class HubSpotService {
  /** Builds the HubSpot authorization URL; `state` carries our org/user context through the redirect. */
  static getAuthorizationUrl(state: string): string {
    const HUBSPOT_CLIENT_ID = process.env.HUBSPOT_CLIENT_ID || "";
    const HUBSPOT_CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET || "";
    const HUBSPOT_REDIRECT_URI =
      process.env.HUBSPOT_REDIRECT_URI ||
      "http://localhost:4000/api/v1/integrations/hubspot/callback";

    const params = new URLSearchParams({
      client_id: HUBSPOT_CLIENT_ID,
      redirect_uri: HUBSPOT_REDIRECT_URI,
      scope: HUBSPOT_SCOPES.join(" "),
      state,
    });

    return `https://app.hubspot.com/oauth/authorize?${params.toString()}`;
  }

  static async exchangeCodeForToken(
    code: string,
  ): Promise<HubSpotTokenResponse> {
    try {
      const HUBSPOT_CLIENT_ID = process.env.HUBSPOT_CLIENT_ID || "";
      const HUBSPOT_CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET || "";
      const HUBSPOT_REDIRECT_URI =
        process.env.HUBSPOT_REDIRECT_URI ||
        "http://localhost:4000/api/v1/integrations/hubspot/callback";

      const response = await axios.post(
        "https://api.hubapi.com/oauth/v1/token",
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: HUBSPOT_CLIENT_ID,
          client_secret: HUBSPOT_CLIENT_SECRET,
          redirect_uri: HUBSPOT_REDIRECT_URI,
          code,
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );
      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in,
      };
    } catch {
      throw AppError.badRequest(
        "Failed to exchange authorization code with HubSpot",
        "HUBSPOT_TOKEN_EXCHANGE_FAILED",
      );
    }
  }

  static async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    try {
      const HUBSPOT_CLIENT_ID = process.env.HUBSPOT_CLIENT_ID || "";
      const HUBSPOT_CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET || "";
      const HUBSPOT_REDIRECT_URI =
        process.env.HUBSPOT_REDIRECT_URI ||
        "http://localhost:4000/api/v1/integrations/hubspot/callback";
      const response = await axios.post(
        "https://api.hubapi.com/oauth/v1/token",
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: HUBSPOT_CLIENT_ID,
          client_secret: HUBSPOT_CLIENT_SECRET,
          refresh_token: refreshToken,
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );
      return {
        accessToken: response.data.access_token,
        expiresIn: response.data.expires_in,
      };
    } catch {
      throw AppError.badRequest(
        "Failed to refresh HubSpot access token",
        "HUBSPOT_TOKEN_REFRESH_FAILED",
      );
    }
  }

  /** Fetches portal (hub) metadata for the connected account, used for display purposes only. */
  static async getTokenInfo(
    accessToken: string,
  ): Promise<HubSpotTokenInfo | null> {
    try {
      const response = await axios.get(
        `https://api.hubapi.com/oauth/v1/access-tokens/${accessToken}`,
      );
      return {
        hubId: String(response.data.hub_id),
        hubDomain: response.data.hub_domain ?? null,
        scopes: response.data.scopes ?? [],
      };
    } catch {
      // Non-critical: connection still succeeds without display metadata.
      return null;
    }
  }

  /** Fetches a page of contacts, requesting only the properties the dashboard needs. */
  static async getContacts(
    accessToken: string,
    limit = 100,
    after?: string,
  ): Promise<HubSpotPaginatedResponse<HubSpotContact>> {
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (after) params.append("after", after);
      [
        "email",
        "firstname",
        "lastname",
        "lifecyclestage",
        "hs_lead_status",
      ].forEach((property) => params.append("properties", property));

      const response = await axios.get(
        `https://api.hubapi.com/crm/v3/objects/contacts?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      return response.data;
    } catch {
      throw AppError.badRequest(
        "Failed to fetch contacts from HubSpot",
        "HUBSPOT_CONTACTS_FETCH_FAILED",
      );
    }
  }

  /**
   * Fetches a page of deals, requesting `propertiesWithHistory=dealstage` so we
   * can persist the stage-change timeline used by the pipeline-progression graph.
   */
  static async getDeals(
    accessToken: string,
    limit = 100,
    after?: string,
  ): Promise<HubSpotPaginatedResponse<HubSpotDeal>> {
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (after) params.append("after", after);
      [
        "dealname",
        "amount",
        "closedate",
        "pipeline",
        "dealstage",
        "hubspot_owner_id",
      ].forEach((property) => params.append("properties", property));
      params.append("propertiesWithHistory", "dealstage");

      const response = await axios.get(
        `https://api.hubapi.com/crm/v3/objects/deals?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      return response.data;
    } catch {
      throw AppError.badRequest(
        "Failed to fetch deals from HubSpot",
        "HUBSPOT_DEALS_FETCH_FAILED",
      );
    }
  }
}
