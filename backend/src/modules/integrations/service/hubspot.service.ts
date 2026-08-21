import axios from "axios";
import { AppError } from "../../../shared/utils/AppError";

/**
 * Scopes needed to establish a HubSpot connection and sync the limited data
 * set the dashboard relies on: contacts and deals (with deal-stage history).
 */
export const HUBSPOT_SCOPES = [
  "oauth",
  "crm.objects.contacts.read",
  "crm.objects.contacts.write",
  "crm.objects.deals.read",
  "crm.objects.deals.write"
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
  propertiesWithHistory?: {
    lifecyclestage?: { value: string; timestamp: string }[];
  };
}

export interface HubSpotPipelineStage {
  id: string;
  label: string;
  displayOrder: number;
  metadata: { isClosed?: string; probability?: string };
}

export interface HubSpotPipeline {
  id: string;
  stages: HubSpotPipelineStage[];
}

export interface HubSpotPropertyOption {
  value: string;
  label: string;
  displayOrder: number;
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

  /**
   * Fetches a page of contacts, requesting only the properties the dashboard needs.
   *
   * When `since` is given, switches from the plain list endpoint to HubSpot's
   * Search API filtered on `lastmodifieddate >= since` (sorted ascending, so
   * incremental syncs page through changes in a stable order) — this is what
   * lets a re-sync pull only records created/updated after the last sync
   * instead of re-fetching the whole portal every time.
   */
  static async getContacts(
    accessToken: string,
    limit = 100,
    after?: string,
    since?: Date,
  ): Promise<HubSpotPaginatedResponse<HubSpotContact>> {
    const properties = [
      "email",
      "firstname",
      "lastname",
      "lifecyclestage",
      "hs_lead_status",
    ];
    try {
      if (since) {
        const response = await axios.post(
          "https://api.hubapi.com/crm/v3/objects/contacts/search",
          {
            filterGroups: [
              {
                filters: [
                  {
                    propertyName: "lastmodifieddate",
                    operator: "GTE",
                    value: String(since.getTime()),
                  },
                ],
              },
            ],
            sorts: [{ propertyName: "lastmodifieddate", direction: "ASCENDING" }],
            properties,
            limit,
            ...(after ? { after } : {}),
          },
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        return response.data;
      }

      const params = new URLSearchParams({ limit: String(limit) });
      if (after) params.append("after", after);
      properties.forEach((property) => params.append("properties", property));
      params.append("propertiesWithHistory", "lifecyclestage");

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

  /** Fetches just the `lifecyclestage` change history for a single contact — used to backfill history for contacts returned by an incremental (Search API) sync. */
  static async getContactLifecycleHistory(
    accessToken: string,
    contactId: string,
  ): Promise<{ value: string; timestamp: string }[]> {
    try {
      const response = await axios.get(
        `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`,
        {
          params: { properties: "lifecyclestage", propertiesWithHistory: "lifecyclestage" },
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      return response.data?.propertiesWithHistory?.lifecyclestage ?? [];
    } catch {
      throw AppError.badRequest(
        "Failed to fetch contact lifecycle stage history from HubSpot",
        "HUBSPOT_CONTACT_HISTORY_FETCH_FAILED",
      );
    }
  }

  /** Fetches deal pipelines and their stages (id/label/order/closed-won metadata) — used to build PipelineStageDefinition rows so the funnel chart can order stages using the portal's real configuration. */
  static async getDealPipelines(accessToken: string): Promise<HubSpotPipeline[]> {
    try {
      const response = await axios.get(
        "https://api.hubapi.com/crm/v3/pipelines/deals",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data?.results ?? [];
    } catch {
      throw AppError.badRequest(
        "Failed to fetch deal pipelines from HubSpot",
        "HUBSPOT_PIPELINES_FETCH_FAILED",
      );
    }
  }

  /** Fetches the portal's configured lifecyclestage options (id/label/order) — HubSpot has no separate "pipeline" object for contacts, this property's options play that role. */
  static async getContactLifecycleStageOptions(accessToken: string): Promise<HubSpotPropertyOption[]> {
    try {
      const response = await axios.get(
        "https://api.hubapi.com/crm/v3/properties/contacts/lifecyclestage",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      return response.data?.options ?? [];
    } catch {
      throw AppError.badRequest(
        "Failed to fetch contact lifecycle stage options from HubSpot",
        "HUBSPOT_LIFECYCLE_OPTIONS_FETCH_FAILED",
      );
    }
  }

  /**
   * Fetches a page of deals. On a full sync (`since` omitted) requests
   * `propertiesWithHistory=dealstage` directly via the list endpoint so we can
   * persist the stage-change timeline used by the pipeline-progression graph.
   *
   * On an incremental sync (`since` given), uses the Search API filtered on
   * `hs_lastmodifieddate >= since` instead — HubSpot's Search API does not
   * support `propertiesWithHistory`, so these results come back without
   * `dealStageHistory`; the caller (`sync.service.ts`) backfills history for
   * just the returned (i.e. changed) deals via `getDealStageHistory`.
   */
  static async getDeals(
    accessToken: string,
    limit = 100,
    after?: string,
    since?: Date,
  ): Promise<HubSpotPaginatedResponse<HubSpotDeal>> {
    const properties = [
      "dealname",
      "amount",
      "closedate",
      "pipeline",
      "dealstage",
      "hubspot_owner_id",
    ];
    try {
      if (since) {
        const response = await axios.post(
          "https://api.hubapi.com/crm/v3/objects/deals/search",
          {
            filterGroups: [
              {
                filters: [
                  {
                    propertyName: "hs_lastmodifieddate",
                    operator: "GTE",
                    value: String(since.getTime()),
                  },
                ],
              },
            ],
            sorts: [{ propertyName: "hs_lastmodifieddate", direction: "ASCENDING" }],
            properties,
            limit,
            ...(after ? { after } : {}),
          },
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        return response.data;
      }

      const params = new URLSearchParams({ limit: String(limit) });
      if (after) params.append("after", after);
      properties.forEach((property) => params.append("properties", property));
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

  /** Fetches just the `dealstage` change history for a single deal — used to backfill history for deals returned by an incremental (Search API) sync. */
  static async getDealStageHistory(
    accessToken: string,
    dealId: string,
  ): Promise<{ value: string; timestamp: string }[]> {
    try {
      const response = await axios.get(
        `https://api.hubapi.com/crm/v3/objects/deals/${dealId}`,
        {
          params: { properties: "dealstage", propertiesWithHistory: "dealstage" },
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      return response.data?.propertiesWithHistory?.dealstage ?? [];
    } catch {
      throw AppError.badRequest(
        "Failed to fetch deal stage history from HubSpot",
        "HUBSPOT_DEAL_HISTORY_FETCH_FAILED",
      );
    }
  }

  /**
   * Batch-resolves deal -> associated contact ids for a whole page of deals in
   * one call (HubSpot's v4 associations batch-read endpoint), instead of one
   * associations call per deal — same anti-N+1 shape as the rest of this
   * service. Used to power the lead-to-deal conversion funnel, which needs to
   * know which contact each deal came from.
   */
  static async getDealContactAssociations(
    accessToken: string,
    dealIds: string[],
  ): Promise<Record<string, string[]>> {
    if (dealIds.length === 0) return {};
    try {
      const response = await axios.post(
        "https://api.hubapi.com/crm/v4/associations/deals/contacts/batch/read",
        { inputs: dealIds.map((id) => ({ id })) },
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const map: Record<string, string[]> = {};
      for (const result of response.data?.results ?? []) {
        map[String(result.from.id)] = (result.to ?? []).map((to: { toObjectId: string | number }) =>
          String(to.toObjectId),
        );
      }
      return map;
    } catch {
      throw AppError.badRequest(
        "Failed to fetch deal-contact associations from HubSpot",
        "HUBSPOT_ASSOCIATIONS_FETCH_FAILED",
      );
    }
  }
}
