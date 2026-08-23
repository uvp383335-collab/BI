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
  /** Value of the org's configured competitor field (Organization.settings.salesforceCompetitorField), when one is configured — null otherwise. CM-03 (metrics guide gap G-11). */
  Competitor: string | null;
}

export interface SalesforceAccount {
  Id: string;
  Name: string | null;
  ParentId: string | null;
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
      const soql = `SELECT Id, Email, FirstName, LastName, Status FROM Lead${whereClause} ORDER BY LastModifiedDate ASC`;
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

  // Custom Salesforce field API names: a letter, then letters/digits/underscores
  // (e.g. `Competitor__c`). Re-validated here — belt-and-suspenders on top of the
  // organizations settings validator — since this value gets interpolated into SOQL.
  private static readonly FIELD_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_]*$/;

  /**
   * Fetches a page of Opportunities — this app's Deal entity for Salesforce.
   * `competitorField` is the org's configured competitor field (CM-03, gap
   * G-11) — Salesforce has no standard field for this, so it's a per-org
   * setting (`Organization.settings.salesforceCompetitorField`) appended to
   * the SELECT list when present, ignored (silently, not thrown) if it
   * fails the field-name check rather than breaking the whole sync over a
   * bad config value.
   */
  static async getOpportunities(
    accessToken: string,
    instanceUrl: string,
    limit: number,
    since?: Date,
    nextRecordsUrl?: string,
    competitorField?: string,
  ): Promise<SalesforcePaginatedResponse<SalesforceOpportunity>> {
    try {
      if (nextRecordsUrl)
        return await this.runQueryPage<SalesforceOpportunity>(accessToken, instanceUrl, nextRecordsUrl);

      const safeCompetitorField = competitorField && this.FIELD_NAME_REGEX.test(competitorField) ? competitorField : undefined;
      const whereClause = since ? ` WHERE LastModifiedDate >= ${since.toISOString()}` : "";
      const competitorSelect = safeCompetitorField ? `, ${safeCompetitorField}` : "";
      const soql = `SELECT Id, Name, Amount, CloseDate, StageName, OwnerId, Type, LeadSource, CampaignId, AccountId${competitorSelect} FROM Opportunity${whereClause} ORDER BY LastModifiedDate ASC`;
      const response = await this.runQuery<Record<string, unknown>>(accessToken, instanceUrl, soql, limit);
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
          Competitor: safeCompetitorField ? ((r[safeCompetitorField] as string) ?? null) : null,
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
   * Batch-resolves opportunity -> named competitor(s) for a whole page of
   * opportunities, via the standard `OpportunityCompetitor` junction object
   * (metrics guide gap G-24's "junction object" mode — the alternative to a
   * single custom field, where a deal can name *multiple* competitors at
   * once). Only called when the org's settings select this mode.
   */
  static async getOpportunityCompetitors(
    accessToken: string,
    instanceUrl: string,
    opportunityIds: string[],
  ): Promise<Record<string, string[]>> {
    if (opportunityIds.length === 0) return {};
    try {
      const ids = opportunityIds.map((id) => `'${id}'`).join(",");
      const soql = `SELECT OpportunityId, CompetitorName FROM OpportunityCompetitor WHERE OpportunityId IN (${ids})`;
      const response = await this.runQuery<{ OpportunityId: string; CompetitorName: string }>(
        accessToken,
        instanceUrl,
        soql,
      );
      const map: Record<string, string[]> = {};
      for (const record of response.records) {
        if (!record.CompetitorName) continue;
        const list = map[record.OpportunityId] ?? [];
        list.push(record.CompetitorName);
        map[record.OpportunityId] = list;
      }
      return map;
    } catch {
      throw AppError.badRequest(
        "Failed to fetch opportunity competitors from Salesforce",
        "SALESFORCE_OPPORTUNITY_COMPETITORS_FETCH_FAILED",
      );
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
}
