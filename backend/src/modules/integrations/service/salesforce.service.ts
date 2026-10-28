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
  OwnerName: string | null;
  /** e.g. "New Customer" — VC-03/VC-06 (metrics guide) use this to identify first-time-customer wins. */
  Type: string | null;
  LeadSource: string | null;
  CampaignId: string | null;
  CampaignName: string | null;
  AccountId: string | null;
  AccountName: string | null;
  /** Value of the org's configured competitor field (Organization.settings.salesforceCompetitorField), when one is configured — null otherwise. CM-03 (metrics guide gap G-11). */
  Competitor: string | null;
  /** The Opportunity's own creation date — Salesforce's equivalent of HubSpot's `createdate`, synced onto `Deal.dealCreatedAt`. CM-05's Salesforce attribution needs "pipeline created this period," same as the HubSpot path. */
  CreatedDate: string | null;
  CreatedByName: string | null;
  LastModifiedDate: string | null;
  LastModifiedByName: string | null;
  ExpectedRevenue: number | null;
  NextStep: string | null;
  Probability: number | null;
  Description: string | null;
  /** Org-configured custom fields (Organization.settings.salesforceOpportunityExtraFields — e.g. Order Number, Current Generator(s)), in the order they were configured. Empty when none are configured. */
  ExtraFields: { label: string; value: string | number | boolean | null }[];
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

export interface SalesforceProduct {
  Id: string;
  Name: string | null;
}

export interface SalesforceCampaign {
  Id: string;
  Name: string | null;
  Type: string | null;
  Status: string | null;
  StartDate: string | null;
  EndDate: string | null;
  IsActive: boolean | null;
  OwnerName: string | null;
  ExpectedRevenue: number | null;
  BudgetedCost: number | null;
  ActualCost: number | null;
  ExpectedResponse: number | null;
  NumberSent: number | null;
  ParentName: string | null;
  Description: string | null;
  CreatedByName: string | null;
  LastModifiedDate: string | null;
  LastModifiedByName: string | null;
  NumberOfLeads: number | null;
  NumberOfConvertedLeads: number | null;
  NumberOfContacts: number | null;
  NumberOfResponses: number | null;
  NumberOfOpportunities: number | null;
  NumberOfWonOpportunities: number | null;
  AmountAllOpportunities: number | null;
  AmountWonOpportunities: number | null;
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
      const responses = await Promise.all(
        this.chunkIds(leadIds).map((chunk) => {
          const ids = chunk.map((id) => `'${id}'`).join(",");
          const soql = `SELECT LeadId, NewValue, CreatedDate FROM LeadHistory WHERE Field = 'Status' AND LeadId IN (${ids}) ORDER BY CreatedDate ASC`;
          return this.runQuery<{ LeadId: string; NewValue: string; CreatedDate: string }>(accessToken, instanceUrl, soql);
        }),
      );
      return responses
        .flatMap((response) => response.records)
        .map((r) => ({ recordId: r.LeadId, value: r.NewValue, timestamp: r.CreatedDate }));
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
   * Cap on how many ids go into a single `WHERE Field IN (...)` batch-read
   * query (LeadHistory/OpportunityHistory/converted-lead/competitor/line-item
   * lookups). These lookups are meant to cover one synced *page* of
   * leads/opportunities, but Salesforce's `Sforce-Query-Options: batchSize`
   * header only accepts 200-2000 — this app's PAGE_SIZE (50, sync.service.ts)
   * is below that minimum, so Salesforce silently ignores it and can return
   * far more than 50 records in a single "page". An IN-clause built from a
   * page that large (tested: 1000 ids) produces a GET request long enough to
   * trip the Salesforce API gateway's own request-line limit
   * (`431 Request Header Fields Too Large`) and fail the whole batch lookup.
   * Chunking defensively — independent of whatever Salesforce actually hands
   * back as "one page" — avoids depending on that implementation detail.
   */
  private static readonly MAX_IDS_PER_BATCH_QUERY = 200;

  private static chunkIds(ids: string[]): string[][] {
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += this.MAX_IDS_PER_BATCH_QUERY) {
      chunks.push(ids.slice(i, i + this.MAX_IDS_PER_BATCH_QUERY));
    }
    return chunks;
  }

  /**
   * Standard Opportunity fields that are NOT guaranteed to exist on every
   * Salesforce edition/org (unlike Id/Name/Amount/StageName/etc, which are
   * universal) — e.g. `ExpectedRevenue` depends on Forecasting being
   * available, which isn't provisioned on every edition. Querying a field
   * that doesn't exist on the org's Opportunity object fails the *entire*
   * SOQL query (INVALID_FIELD), so these are validated against a live
   * Describe call before being added to the SELECT list — same "degrade
   * instead of failing the whole sync" philosophy already used for the
   * competitor field / extra fields / Campaign / OpportunityCompetitor /
   * OpportunityLineItem access below.
   */
  private static readonly OPTIONAL_STANDARD_FIELDS = ["ExpectedRevenue", "NextStep", "Probability", "Description"] as const;

  /** `GET .../sobjects/Opportunity/describe` — field metadata, used only to check which OPTIONAL_STANDARD_FIELDS this org's Opportunity object actually has. */
  private static async getAvailableOpportunityFields(accessToken: string, instanceUrl: string): Promise<Set<string>> {
    try {
      const response = await axios.get(
        `${instanceUrl}/services/data/${SALESFORCE_API_VERSION}/sobjects/Opportunity/describe`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const fields = (response.data?.fields ?? []) as { name: string }[];
      return new Set(fields.map((f) => f.name));
    } catch {
      // Describe is a defensive availability check, not core sync data — if
      // it fails, assume all optional fields are available (prior behavior)
      // rather than silently dropping detail-view data that may be fine.
      return new Set(this.OPTIONAL_STANDARD_FIELDS);
    }
  }

  /**
   * Fetches a page of Opportunities — this app's Deal entity for Salesforce.
   * `competitorField` is the org's configured competitor field (CM-03, gap
   * G-11); `extraFields` is the org's configured list of additional detail-
   * view fields (Order Number, Current Generator(s), etc — Organization.
   * settings.salesforceOpportunityExtraFields). Both are per-org settings
   * with no fixed Salesforce API name, appended to the SELECT list when
   * present and re-validated against FIELD_NAME_REGEX here (belt-and-
   * suspenders on top of the settings validator) since they're interpolated
   * into SOQL — an entry that fails the check is silently dropped rather
   * than breaking the whole sync over one bad config value.
   *
   * The pagination branch (`nextRecordsUrl`) re-applies the same field
   * mapping as the first page — Salesforce's raw JSON nests relationship
   * fields (`Owner.Name` comes back as `{Owner: {Name: ...}}`, not a flat
   * `OwnerName` key), so every page needs the same flattening, not just the
   * page that built the SOQL.
   */
  static async getOpportunities(
    accessToken: string,
    instanceUrl: string,
    limit: number,
    since?: Date,
    nextRecordsUrl?: string,
    competitorField?: string,
    extraFields?: { apiName: string; label: string }[],
  ): Promise<SalesforcePaginatedResponse<SalesforceOpportunity>> {
    try {
      const safeCompetitorField = competitorField && this.FIELD_NAME_REGEX.test(competitorField) ? competitorField : undefined;
      const safeExtraFields = (extraFields ?? []).filter((f) => this.FIELD_NAME_REGEX.test(f.apiName));

      if (nextRecordsUrl) {
        const response = await this.runQueryPage<Record<string, unknown>>(accessToken, instanceUrl, nextRecordsUrl);
        return this.mapOpportunityResponse(response, safeCompetitorField, safeExtraFields);
      }

      const availableFields = await this.getAvailableOpportunityFields(accessToken, instanceUrl);
      const optionalSelect = this.OPTIONAL_STANDARD_FIELDS.filter((f) => availableFields.has(f));

      const whereClause = since ? ` WHERE LastModifiedDate >= ${since.toISOString()}` : "";
      const optionalFieldsSelect = optionalSelect.length > 0 ? `, ${optionalSelect.join(", ")}` : "";
      const competitorSelect = safeCompetitorField ? `, ${safeCompetitorField}` : "";
      const extraSelect = safeExtraFields.length > 0 ? `, ${safeExtraFields.map((f) => f.apiName).join(", ")}` : "";
      const soql = `SELECT Id, Name, Amount, CloseDate, StageName, OwnerId, Owner.Name, Type, LeadSource, CampaignId, Campaign.Name, AccountId, Account.Name, CreatedDate, CreatedBy.Name, LastModifiedDate, LastModifiedBy.Name${optionalFieldsSelect}${competitorSelect}${extraSelect} FROM Opportunity${whereClause} ORDER BY LastModifiedDate ASC`;
      const response = await this.runQuery<Record<string, unknown>>(accessToken, instanceUrl, soql, limit);
      return this.mapOpportunityResponse(response, safeCompetitorField, safeExtraFields);
    } catch {
      throw AppError.badRequest(
        "Failed to fetch opportunities from Salesforce",
        "SALESFORCE_OPPORTUNITIES_FETCH_FAILED",
      );
    }
  }

  private static mapOpportunityResponse(
    response: SalesforcePaginatedResponse<Record<string, unknown>>,
    safeCompetitorField: string | undefined,
    safeExtraFields: { apiName: string; label: string }[],
  ): SalesforcePaginatedResponse<SalesforceOpportunity> {
    const relName = (r: Record<string, unknown>, key: string): string | null => {
      const rel = r[key] as { Name?: string } | null | undefined;
      return rel?.Name ?? null;
    };
    return {
      ...response,
      records: response.records.map((r) => ({
        Id: r.Id as string,
        Name: (r.Name as string) ?? null,
        Amount: (r.Amount as number) ?? null,
        CloseDate: (r.CloseDate as string) ?? null,
        StageName: (r.StageName as string) ?? null,
        OwnerId: (r.OwnerId as string) ?? null,
        OwnerName: relName(r, "Owner"),
        Type: (r.Type as string) ?? null,
        LeadSource: (r.LeadSource as string) ?? null,
        CampaignId: (r.CampaignId as string) ?? null,
        CampaignName: relName(r, "Campaign"),
        AccountId: (r.AccountId as string) ?? null,
        AccountName: relName(r, "Account"),
        Competitor: safeCompetitorField ? ((r[safeCompetitorField] as string) ?? null) : null,
        CreatedDate: (r.CreatedDate as string) ?? null,
        CreatedByName: relName(r, "CreatedBy"),
        LastModifiedDate: (r.LastModifiedDate as string) ?? null,
        LastModifiedByName: relName(r, "LastModifiedBy"),
        ExpectedRevenue: (r.ExpectedRevenue as number) ?? null,
        NextStep: (r.NextStep as string) ?? null,
        Probability: (r.Probability as number) ?? null,
        Description: (r.Description as string) ?? null,
        ExtraFields: safeExtraFields.map((f) => ({
          label: f.label,
          value: (r[f.apiName] as string | number | boolean | undefined) ?? null,
        })),
      })),
    };
  }

  /** Batched `StageName` change history for a page of opportunities via the standard OpportunityHistory object (always on, unlike LeadHistory — no tracking opt-in required). */
  static async getOpportunityStageHistory(
    accessToken: string,
    instanceUrl: string,
    opportunityIds: string[],
  ): Promise<SalesforceStageHistoryEntry[]> {
    if (opportunityIds.length === 0) return [];
    try {
      const responses = await Promise.all(
        this.chunkIds(opportunityIds).map((chunk) => {
          const ids = chunk.map((id) => `'${id}'`).join(",");
          const soql = `SELECT OpportunityId, StageName, CreatedDate FROM OpportunityHistory WHERE OpportunityId IN (${ids}) ORDER BY CreatedDate ASC`;
          return this.runQuery<{ OpportunityId: string; StageName: string; CreatedDate: string }>(accessToken, instanceUrl, soql);
        }),
      );
      return responses
        .flatMap((response) => response.records)
        .map((r) => ({ recordId: r.OpportunityId, value: r.StageName, timestamp: r.CreatedDate }));
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
      const responses = await Promise.all(
        this.chunkIds(opportunityIds).map((chunk) => {
          const ids = chunk.map((id) => `'${id}'`).join(",");
          const soql = `SELECT Id, ConvertedOpportunityId FROM Lead WHERE IsConverted = true AND ConvertedOpportunityId IN (${ids})`;
          return this.runQuery<{ Id: string; ConvertedOpportunityId: string }>(accessToken, instanceUrl, soql);
        }),
      );
      const map: Record<string, string[]> = {};
      for (const record of responses.flatMap((response) => response.records)) {
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
      const responses = await Promise.all(
        this.chunkIds(opportunityIds).map((chunk) => {
          const ids = chunk.map((id) => `'${id}'`).join(",");
          const soql = `SELECT OpportunityId, CompetitorName FROM OpportunityCompetitor WHERE OpportunityId IN (${ids})`;
          return this.runQuery<{ OpportunityId: string; CompetitorName: string }>(accessToken, instanceUrl, soql);
        }),
      );
      const map: Record<string, string[]> = {};
      for (const record of responses.flatMap((response) => response.records)) {
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
      const responses = await Promise.all(
        this.chunkIds(opportunityIds).map((chunk) => {
          const ids = chunk.map((id) => `'${id}'`).join(",");
          const soql = `SELECT OpportunityId, Product2Id FROM OpportunityLineItem WHERE OpportunityId IN (${ids}) AND Product2Id != null`;
          return this.runQuery<{ OpportunityId: string; Product2Id: string }>(accessToken, instanceUrl, soql);
        }),
      );
      const map: Record<string, string[]> = {};
      for (const record of responses.flatMap((response) => response.records)) {
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
   * Fetches a page of Campaigns, including the standard Campaign ROI/
   * influence rollup fields (NumberOfLeads, NumberOfOpportunities,
   * AmountWonOpportunities, etc — the same numbers Salesforce's own
   * "Campaign Influence Report" is built from) so the Campaigns browse view
   * can show a full detail panel, not just a name/type label.
   */
  static async getCampaigns(
    accessToken: string,
    instanceUrl: string,
    limit: number,
    since?: Date,
    nextRecordsUrl?: string,
  ): Promise<SalesforcePaginatedResponse<SalesforceCampaign>> {
    try {
      if (nextRecordsUrl) return await this.runQueryPage<Record<string, unknown>>(accessToken, instanceUrl, nextRecordsUrl).then(this.mapCampaignResponse);

      const whereClause = since ? ` WHERE LastModifiedDate >= ${since.toISOString()}` : "";
      const soql = `SELECT Id, Name, Type, Status, StartDate, EndDate, IsActive, Owner.Name, ExpectedRevenue, BudgetedCost, ActualCost, ExpectedResponse, NumberSent, Parent.Name, Description, CreatedBy.Name, LastModifiedDate, LastModifiedBy.Name, NumberOfLeads, NumberOfConvertedLeads, NumberOfContacts, NumberOfResponses, NumberOfOpportunities, NumberOfWonOpportunities, AmountAllOpportunities, AmountWonOpportunities FROM Campaign${whereClause} ORDER BY LastModifiedDate ASC`;
      const response = await this.runQuery<Record<string, unknown>>(accessToken, instanceUrl, soql, limit);
      return this.mapCampaignResponse(response);
    } catch {
      throw AppError.badRequest("Failed to fetch campaigns from Salesforce", "SALESFORCE_CAMPAIGNS_FETCH_FAILED");
    }
  }

  private static mapCampaignResponse(
    response: SalesforcePaginatedResponse<Record<string, unknown>>,
  ): SalesforcePaginatedResponse<SalesforceCampaign> {
    const relName = (r: Record<string, unknown>, key: string): string | null => {
      const rel = r[key] as { Name?: string } | null | undefined;
      return rel?.Name ?? null;
    };
    return {
      ...response,
      records: response.records.map((r) => ({
        Id: r.Id as string,
        Name: (r.Name as string) ?? null,
        Type: (r.Type as string) ?? null,
        Status: (r.Status as string) ?? null,
        StartDate: (r.StartDate as string) ?? null,
        EndDate: (r.EndDate as string) ?? null,
        IsActive: (r.IsActive as boolean) ?? null,
        OwnerName: relName(r, "Owner"),
        ExpectedRevenue: (r.ExpectedRevenue as number) ?? null,
        BudgetedCost: (r.BudgetedCost as number) ?? null,
        ActualCost: (r.ActualCost as number) ?? null,
        ExpectedResponse: (r.ExpectedResponse as number) ?? null,
        NumberSent: (r.NumberSent as number) ?? null,
        ParentName: relName(r, "Parent"),
        Description: (r.Description as string) ?? null,
        CreatedByName: relName(r, "CreatedBy"),
        LastModifiedDate: (r.LastModifiedDate as string) ?? null,
        LastModifiedByName: relName(r, "LastModifiedBy"),
        NumberOfLeads: (r.NumberOfLeads as number) ?? null,
        NumberOfConvertedLeads: (r.NumberOfConvertedLeads as number) ?? null,
        NumberOfContacts: (r.NumberOfContacts as number) ?? null,
        NumberOfResponses: (r.NumberOfResponses as number) ?? null,
        NumberOfOpportunities: (r.NumberOfOpportunities as number) ?? null,
        NumberOfWonOpportunities: (r.NumberOfWonOpportunities as number) ?? null,
        AmountAllOpportunities: (r.AmountAllOpportunities as number) ?? null,
        AmountWonOpportunities: (r.AmountWonOpportunities as number) ?? null,
      })),
    };
  }
}
