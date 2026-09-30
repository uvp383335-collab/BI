import axios from "axios";
import { AppError } from "../../../shared/utils/AppError";

const SALESFORCE_API_VERSION = "v65.0";

/** Deliberately narrow: API access + refresh token only, mirroring HubSpot's narrow-scope policy. */
export const SALESFORCE_SCOPES = ["api", "refresh_token"];

/**
 * Salesforce's OAuth token response carries no `expires_in` (unlike HubSpot) —
 * validity is governed by the connected org's session-timeout policy instead,
 * which this app has no way to introspect. We fall back to a conservative
 * default and rely on the same expiresAt-based proactive refresh every other
 * provider uses.
 */
const DEFAULT_TOKEN_TTL_SECONDS = 2 * 60 * 60;

function loginUrl(): string {
  return process.env.SALESFORCE_LOGIN_URL || "https://login.salesforce.com";
}

export interface SalesforceTokenResponse {
  accessToken: string;
  refreshToken: string;
  instanceUrl: string;
  /** Salesforce org id, parsed from the token response's `id` identity URL — avoids a separate identity API call. */
  externalAccountId: string;
  scope: string[];
  expiresIn: number;
}

export interface SalesforcePaginatedResponse<T> {
  records: T[];
  nextRecordsUrl?: string;
  done: boolean;
}

export interface SalesforceLead {
  Id: string;
  Email: string | null;
  FirstName: string | null;
  LastName: string | null;
  Status: string | null;
  /** Assigned rep — the sales owner currently working this lead. Relationship field, comes back nested as `{ Name }`. */
  Owner: { Name: string | null } | null;
}

export interface SalesforceOpportunity {
  Id: string;
  Name: string | null;
  Amount: number | null;
  CloseDate: string | null;
  StageName: string | null;
  OwnerId: string | null;
  /** e.g. "New Customer" — VC-03/VC-06 (metrics guide) use this to identify first-time-customer wins. */
  Type: string | null;
  LeadSource: string | null;
  CampaignId: string | null;
  AccountId: string | null;
  /** Named competitors on this deal, parsed from the `MainCompetitors__c` Opportunity field (semicolon-separated) — CM-03. Empty when the field is blank or the org's Opportunity object doesn't have it. */
  Competitors: string[];
}

export interface SalesforceAccount {
  Id: string;
  Name: string | null;
  ParentId: string | null;
}

export interface SalesforceCampaign {
  Id: string;
  Name: string | null;
  Type: string | null;
  IsActive: boolean;
  ActualCost: number | null;
  /** Standard Salesforce rollup fields — computed automatically from Leads/Opportunities that reference this Campaign, never set directly. */
  NumberOfLeads: number | null;
  NumberOfConvertedLeads: number | null;
  NumberOfOpportunities: number | null;
  NumberOfWonOpportunities: number | null;
  AmountAllOpportunities: number | null;
  AmountWonOpportunities: number | null;
}

export interface SalesforceStageHistoryEntry {
  recordId: string;
  value: string;
  timestamp: string;
}

export interface SalesforcePicklistStage {
  apiName: string;
  label: string;
  sortOrder: number;
  isClosed: boolean;
  isWon: boolean;
}

export interface SalesforceProduct {
  Id: string;
  Name: string | null;
}

/**
 * Thin wrapper around Salesforce's OAuth + SOQL query endpoints. Leads are
 * synced into this app's generic Contact entity and Opportunities into its
 * generic Deal entity — see crm-integrations skill, Salesforce section, for
 * why (this app treats a Lead as "the contact" rather than Salesforce's
 * separate Contact object).
 */
export class SalesforceService {
  static getAuthorizationUrl(state: string, codeChallenge: string): string {
    const clientId = process.env.SALESFORCE_CLIENT_ID || "";
    const redirectUri =
      process.env.SALESFORCE_REDIRECT_URI ||
      "http://localhost:4000/api/v1/integrations/salesforce/callback";

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: SALESFORCE_SCOPES.join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    return `${loginUrl()}/services/oauth2/authorize?${params.toString()}`;
  }

  static async exchangeCodeForToken(
    code: string,
    codeVerifier: string,
  ): Promise<SalesforceTokenResponse> {
    try {
      const clientId = process.env.SALESFORCE_CLIENT_ID || "";
      const clientSecret = process.env.SALESFORCE_CLIENT_SECRET || "";
      const redirectUri =
        process.env.SALESFORCE_REDIRECT_URI ||
        "http://localhost:4000/api/v1/integrations/salesforce/callback";

      const response = await axios.post(
        `${loginUrl()}/services/oauth2/token`,
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          code,
          code_verifier: codeVerifier,
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );

      // Salesforce's recommended way to resolve the connected org's id without
      // a separate identity-API round trip: `id` is
      // https://<host>/id/{orgId}/{userId}.
      const idParts = String(response.data.id || "").split("/");
      const externalAccountId = idParts[idParts.length - 2] || "";

      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        instanceUrl: response.data.instance_url,
        externalAccountId,
        scope: response.data.scope ? String(response.data.scope).split(" ") : [],
        expiresIn: DEFAULT_TOKEN_TTL_SECONDS,
      };
    } catch {
      throw AppError.badRequest(
        "Failed to exchange authorization code with Salesforce",
        "SALESFORCE_TOKEN_EXCHANGE_FAILED",
      );
    }
  }

  static async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; instanceUrl: string; expiresIn: number }> {
    try {
      const clientId = process.env.SALESFORCE_CLIENT_ID || "";
      const clientSecret = process.env.SALESFORCE_CLIENT_SECRET || "";

      const response = await axios.post(
        `${loginUrl()}/services/oauth2/token`,
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
        }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );
      return {
        accessToken: response.data.access_token,
        instanceUrl: response.data.instance_url,
        expiresIn: DEFAULT_TOKEN_TTL_SECONDS,
      };
    } catch {
      throw AppError.badRequest(
        "Failed to refresh Salesforce access token",
        "SALESFORCE_TOKEN_REFRESH_FAILED",
      );
    }
  }

  private static async runQuery<T>(
    accessToken: string,
    instanceUrl: string,
    soql: string,
    batchSize?: number,
  ): Promise<SalesforcePaginatedResponse<T>> {
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
    if (batchSize) headers["Sforce-Query-Options"] = `batchSize=${batchSize}`;

    const response = await axios.get(
      `${instanceUrl}/services/data/${SALESFORCE_API_VERSION}/query`,
      { params: { q: soql }, headers },
    );
    return {
      records: response.data.records ?? [],
      nextRecordsUrl: response.data.nextRecordsUrl,
      done: response.data.done,
    };
  }

  private static async runQueryPage<T>(
    accessToken: string,
    instanceUrl: string,
    nextRecordsUrl: string,
  ): Promise<SalesforcePaginatedResponse<T>> {
    const response = await axios.get(`${instanceUrl}${nextRecordsUrl}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return {
      records: response.data.records ?? [],
      nextRecordsUrl: response.data.nextRecordsUrl,
      done: response.data.done,
    };
  }

  /**
   * Fetches a page of Leads — this app's Contact entity for Salesforce.
   * Pagination follows Salesforce's own `nextRecordsUrl` cursor (SOQL OFFSET
   * caps out at 2000 rows, so it can't be used for full-portal sync).
   */
  static async getLeads(
    accessToken: string,
    instanceUrl: string,
    limit: number,
    since?: Date,
    nextRecordsUrl?: string,
  ): Promise<SalesforcePaginatedResponse<SalesforceLead>> {
    try {
      if (nextRecordsUrl) return await this.runQueryPage<SalesforceLead>(accessToken, instanceUrl, nextRecordsUrl);

      const whereClause = since ? ` WHERE LastModifiedDate >= ${since.toISOString()}` : "";
      const soql = `SELECT Id, Email, FirstName, LastName, Status, Owner.Name FROM Lead${whereClause} ORDER BY LastModifiedDate ASC`;
      return await this.runQuery<SalesforceLead>(accessToken, instanceUrl, soql, limit);
    } catch {
      throw AppError.badRequest("Failed to fetch leads from Salesforce", "SALESFORCE_LEADS_FETCH_FAILED");
    }
  }

  /**
   * Batched `Status` change history for a page of leads via the LeadHistory
   * object — Salesforce's equivalent of HubSpot's `propertiesWithHistory`,
   * except it always requires a separate query (no embedding into the list
   * call) and depends on field history tracking being enabled for `Status`
   * on the connected org. Degrades to an empty history rather than failing
   * the sync when tracking isn't enabled.
   */
  static async getLeadStatusHistory(
    accessToken: string,
    instanceUrl: string,
    leadIds: string[],
  ): Promise<SalesforceStageHistoryEntry[]> {
    if (leadIds.length === 0) return [];
    try {
      const ids = leadIds.map((id) => `'${id}'`).join(",");
      const soql = `SELECT LeadId, NewValue, CreatedDate FROM LeadHistory WHERE Field = 'Status' AND LeadId IN (${ids}) ORDER BY CreatedDate ASC`;
      const response = await this.runQuery<{ LeadId: string; NewValue: string; CreatedDate: string }>(
        accessToken,
        instanceUrl,
        soql,
      );
      return response.records.map((r) => ({ recordId: r.LeadId, value: r.NewValue, timestamp: r.CreatedDate }));
    } catch {
      return [];
    }
  }

  /** Fetches the org's configured Lead Status picklist values (id/label/order/converted-flag) — Salesforce's equivalent of HubSpot's lifecyclestage property options. */
  static async getLeadStatuses(accessToken: string, instanceUrl: string): Promise<SalesforcePicklistStage[]> {
    try {
      const soql = "SELECT ApiName, MasterLabel, SortOrder, IsConverted FROM LeadStatus ORDER BY SortOrder";
      const response = await this.runQuery<{
        ApiName: string;
        MasterLabel: string;
        SortOrder: number;
        IsConverted: boolean;
      }>(accessToken, instanceUrl, soql);
      return response.records.map((r) => ({
        apiName: r.ApiName,
        label: r.MasterLabel,
        sortOrder: r.SortOrder,
        isClosed: r.IsConverted,
        isWon: r.IsConverted,
      }));
    } catch {
      throw AppError.badRequest(
        "Failed to fetch lead statuses from Salesforce",
        "SALESFORCE_LEAD_STATUSES_FETCH_FAILED",
      );
    }
  }

  /**
   * Fetches a page of Opportunities — this app's Deal entity for Salesforce.
   * Always selects `MainCompetitors__c` (CM-03's named-competitor source) —
   * no per-org config, matches docs/salesforce-oauth-learning/server.js's
   * own Opportunity query exactly. A semicolon-separated list on that field
   * (Salesforce's own convention, same as the prototype) is split into
   * `Competitors` here rather than left for the caller to parse.
   */
  static async getOpportunities(
    accessToken: string,
    instanceUrl: string,
    limit: number,
    since?: Date,
    nextRecordsUrl?: string,
  ): Promise<SalesforcePaginatedResponse<SalesforceOpportunity>> {
    try {
      if (nextRecordsUrl)
        return await this.runQueryPage<SalesforceOpportunity>(accessToken, instanceUrl, nextRecordsUrl);

      const whereClause = since ? ` WHERE LastModifiedDate >= ${since.toISOString()}` : "";
      const baseFields = "Id, Name, Amount, CloseDate, StageName, OwnerId, Type, LeadSource, CampaignId, AccountId";
      const soqlWithCompetitors = `SELECT ${baseFields}, MainCompetitors__c FROM Opportunity${whereClause} ORDER BY LastModifiedDate ASC`;

      let response: SalesforcePaginatedResponse<Record<string, unknown>>;
      try {
        response = await this.runQuery<Record<string, unknown>>(accessToken, instanceUrl, soqlWithCompetitors, limit);
      } catch {
        // MainCompetitors__c is a Developer-Edition sample-data field, not a standard
        // Salesforce field — an org without it would otherwise fail this whole sync step.
        // Retry without it so contacts/deals still sync; CM-03 just has nothing to read.
        const soqlWithoutCompetitors = `SELECT ${baseFields} FROM Opportunity${whereClause} ORDER BY LastModifiedDate ASC`;
        response = await this.runQuery<Record<string, unknown>>(accessToken, instanceUrl, soqlWithoutCompetitors, limit);
      }

      return {
        ...response,
        records: response.records.map((r) => ({
          Id: r.Id as string,
          Name: (r.Name as string) ?? null,
          Amount: (r.Amount as number) ?? null,
          CloseDate: (r.CloseDate as string) ?? null,
          StageName: (r.StageName as string) ?? null,
          OwnerId: (r.OwnerId as string) ?? null,
          Type: (r.Type as string) ?? null,
          LeadSource: (r.LeadSource as string) ?? null,
          CampaignId: (r.CampaignId as string) ?? null,
          AccountId: (r.AccountId as string) ?? null,
          Competitors: String(r.MainCompetitors__c ?? "")
            .split(";")
            .map((c) => c.trim())
            .filter(Boolean),
        })),
      };
    } catch {
      throw AppError.badRequest(
        "Failed to fetch opportunities from Salesforce",
        "SALESFORCE_OPPORTUNITIES_FETCH_FAILED",
      );
    }
  }

  /** Batched `StageName` change history for a page of opportunities via the standard OpportunityHistory object (always on, unlike LeadHistory — no tracking opt-in required). */
  static async getOpportunityStageHistory(
    accessToken: string,
    instanceUrl: string,
    opportunityIds: string[],
  ): Promise<SalesforceStageHistoryEntry[]> {
    if (opportunityIds.length === 0) return [];
    try {
      const ids = opportunityIds.map((id) => `'${id}'`).join(",");
      const soql = `SELECT OpportunityId, StageName, CreatedDate FROM OpportunityHistory WHERE OpportunityId IN (${ids}) ORDER BY CreatedDate ASC`;
      const response = await this.runQuery<{ OpportunityId: string; StageName: string; CreatedDate: string }>(
        accessToken,
        instanceUrl,
        soql,
      );
      return response.records.map((r) => ({ recordId: r.OpportunityId, value: r.StageName, timestamp: r.CreatedDate }));
    } catch {
      throw AppError.badRequest(
        "Failed to fetch opportunity stage history from Salesforce",
        "SALESFORCE_OPPORTUNITY_HISTORY_FETCH_FAILED",
      );
    }
  }

  /** Fetches the org's configured Opportunity Stage picklist values (id/label/order/closed-won flags) — Salesforce's equivalent of HubSpot's deal pipelines API. Salesforce has no separate multi-pipeline concept by default, so this is treated as a single synthetic pipeline (see sync.service's OPPORTUNITIES_PIPELINE). */
  static async getOpportunityStages(accessToken: string, instanceUrl: string): Promise<SalesforcePicklistStage[]> {
    try {
      const soql = "SELECT ApiName, MasterLabel, SortOrder, IsClosed, IsWon FROM OpportunityStage ORDER BY SortOrder";
      const response = await this.runQuery<{
        ApiName: string;
        MasterLabel: string;
        SortOrder: number;
        IsClosed: boolean;
        IsWon: boolean;
      }>(accessToken, instanceUrl, soql);
      return response.records.map((r) => ({
        apiName: r.ApiName,
        label: r.MasterLabel,
        sortOrder: r.SortOrder,
        isClosed: r.IsClosed,
        isWon: r.IsWon,
      }));
    } catch {
      throw AppError.badRequest(
        "Failed to fetch opportunity stages from Salesforce",
        "SALESFORCE_OPPORTUNITY_STAGES_FETCH_FAILED",
      );
    }
  }

  /**
   * Batch-resolves opportunity -> converted lead id(s) for a whole page of
   * opportunities in one query, via the native `ConvertedOpportunityId` field
   * Salesforce stamps onto a Lead when it converts. This is this app's
   * equivalent of HubSpot's deal-contact associations batch call, and the
   * natural bridge given Leads (not Salesforce's separate Contact object) are
   * treated as the "contact" entity here. Powers the lead-to-deal conversion
   * funnel.
   */
  static async getConvertedLeadIdsByOpportunity(
    accessToken: string,
    instanceUrl: string,
    opportunityIds: string[],
  ): Promise<Record<string, string[]>> {
    if (opportunityIds.length === 0) return {};
    try {
      const ids = opportunityIds.map((id) => `'${id}'`).join(",");
      const soql = `SELECT Id, ConvertedOpportunityId FROM Lead WHERE IsConverted = true AND ConvertedOpportunityId IN (${ids})`;
      const response = await this.runQuery<{ Id: string; ConvertedOpportunityId: string }>(
        accessToken,
        instanceUrl,
        soql,
      );
      const map: Record<string, string[]> = {};
      for (const record of response.records) {
        const list = map[record.ConvertedOpportunityId] ?? [];
        list.push(record.Id);
        map[record.ConvertedOpportunityId] = list;
      }
      return map;
    } catch {
      throw AppError.badRequest(
        "Failed to fetch converted lead associations from Salesforce",
        "SALESFORCE_ASSOCIATIONS_FETCH_FAILED",
      );
    }
  }

  /**
   * Batch-resolves opportunity -> associated product id(s) for a whole page
   * of opportunities, via the standard `OpportunityLineItem` junction object
   * (Salesforce's equivalent of HubSpot's deal -> line_item -> product hop,
   * collapsed into one query since OpportunityLineItem carries Product2Id
   * directly rather than needing a second batch-read). Powers the funnel
   * product filter (Deal.productIds).
   */
  static async getOpportunityLineItemProducts(
    accessToken: string,
    instanceUrl: string,
    opportunityIds: string[],
  ): Promise<Record<string, string[]>> {
    if (opportunityIds.length === 0) return {};
    try {
      const ids = opportunityIds.map((id) => `'${id}'`).join(",");
      const soql = `SELECT OpportunityId, Product2Id FROM OpportunityLineItem WHERE OpportunityId IN (${ids}) AND Product2Id != null`;
      const response = await this.runQuery<{ OpportunityId: string; Product2Id: string }>(
        accessToken,
        instanceUrl,
        soql,
      );
      const map: Record<string, string[]> = {};
      for (const record of response.records) {
        const list = map[record.OpportunityId] ?? [];
        if (!list.includes(record.Product2Id)) list.push(record.Product2Id);
        map[record.OpportunityId] = list;
      }
      return map;
    } catch {
      throw AppError.badRequest(
        "Failed to fetch opportunity line item products from Salesforce",
        "SALESFORCE_LINE_ITEM_PRODUCTS_FETCH_FAILED",
      );
    }
  }

  /** Paginates the org's full product catalog (id + name only) — labels for the funnel product-filter dropdown, refreshed once per sync job like the pipeline/lead-status metadata. Not filtered on IsActive so older deals' products still resolve a name. */
  static async getProducts(
    accessToken: string,
    instanceUrl: string,
    limit: number,
    nextRecordsUrl?: string,
  ): Promise<SalesforcePaginatedResponse<SalesforceProduct>> {
    try {
      if (nextRecordsUrl) return await this.runQueryPage<SalesforceProduct>(accessToken, instanceUrl, nextRecordsUrl);

      const soql = "SELECT Id, Name FROM Product2 ORDER BY Name";
      return await this.runQuery<SalesforceProduct>(accessToken, instanceUrl, soql, limit);
    } catch {
      throw AppError.badRequest("Failed to fetch products from Salesforce", "SALESFORCE_PRODUCTS_FETCH_FAILED");
    }
  }

  /**
   * Fetches a page of Accounts — deliberately narrow (`Id`, `Name`, `ParentId`
   * only, per the existing narrow-sync policy). Not this app's Contact entity
   * (Leads are, see class doc comment) — Account exists here solely to
   * resolve subsidiary hierarchy for CM-02's customer-concentration grouping.
   */
  static async getAccounts(
    accessToken: string,
    instanceUrl: string,
    limit: number,
    since?: Date,
    nextRecordsUrl?: string,
  ): Promise<SalesforcePaginatedResponse<SalesforceAccount>> {
    try {
      if (nextRecordsUrl) return await this.runQueryPage<SalesforceAccount>(accessToken, instanceUrl, nextRecordsUrl);

      const whereClause = since ? ` WHERE LastModifiedDate >= ${since.toISOString()}` : "";
      const soql = `SELECT Id, Name, ParentId FROM Account${whereClause} ORDER BY LastModifiedDate ASC`;
      return await this.runQuery<SalesforceAccount>(accessToken, instanceUrl, soql, limit);
    } catch {
      throw AppError.badRequest("Failed to fetch accounts from Salesforce", "SALESFORCE_ACCOUNTS_FETCH_FAILED");
    }
  }

  /**
   * Fetches a page of Campaigns — cost + the standard won-opportunity/lead
   * rollups, exactly the fields CAC / marketing-ROI-by-channel needs.
   */
  static async getCampaigns(
    accessToken: string,
    instanceUrl: string,
    limit: number,
    since?: Date,
    nextRecordsUrl?: string,
  ): Promise<SalesforcePaginatedResponse<SalesforceCampaign>> {
    try {
      if (nextRecordsUrl) return await this.runQueryPage<SalesforceCampaign>(accessToken, instanceUrl, nextRecordsUrl);

      const whereClause = since ? ` WHERE LastModifiedDate >= ${since.toISOString()}` : "";
      const soql = `SELECT Id, Name, Type, IsActive, ActualCost, NumberOfLeads, NumberOfConvertedLeads,
        NumberOfOpportunities, NumberOfWonOpportunities, AmountAllOpportunities, AmountWonOpportunities
        FROM Campaign${whereClause} ORDER BY LastModifiedDate ASC`;
      return await this.runQuery<SalesforceCampaign>(accessToken, instanceUrl, soql, limit);
    } catch {
      throw AppError.badRequest("Failed to fetch campaigns from Salesforce", "SALESFORCE_CAMPAIGNS_FETCH_FAILED");
    }
  }
}
