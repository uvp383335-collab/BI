import axios from "axios";
import { AppError } from "../../../shared/utils/AppError";

/**
 * Deliberately narrow: read/write access to the company's accounting data
 * only, no payments/payroll scopes — mirrors the other providers' policy of
 * not requesting more than the app needs.
 */
export const QUICKBOOKS_SCOPES = ["com.intuit.quickbooks.accounting"];

// Fixed Intuit endpoints — unlike Salesforce, these don't vary per connected
// account (the per-account bit is `realmId`, carried on every API call, not
// the OAuth host).
const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

export interface QuickBooksTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// The accounting API host differs between a sandbox and a production Intuit
// app (unlike the fixed OAuth host above) — set QUICKBOOKS_ENVIRONMENT=production
// once a portfolio company connects a real (non-sandbox) QuickBooks company.
const ACCOUNTING_API_HOST =
  process.env.QUICKBOOKS_ENVIRONMENT === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";

export interface QuickBooksCustomer {
  Id: string;
  DisplayName?: string;
  ParentRef?: { value: string };
  Active?: boolean;
}

export interface QuickBooksInvoice {
  Id: string;
  CustomerRef: { value: string };
  TxnDate: string;
  TotalAmt: number;
}

export interface QuickBooksItem {
  Id: string;
  Name?: string;
  Type?: string;
}

export interface QuickBooksDepartment {
  Id: string;
  Name?: string;
}

export interface QuickBooksCustomerWithBillingAddress extends QuickBooksCustomer {
  BillAddr?: { CountrySubDivisionCode?: string };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn` over `items` with at most `limit` calls in flight at once —
 * QuickBooks rate-limits bursts, so N parallel report requests (one per
 * item, per the per-item P&L sync) need throttling rather than firing all
 * at once. Ported from docs/server.js's mapWithConcurrency. Returns results
 * in the same shape as Promise.allSettled.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export interface QuickBooksPage<T> {
  records: T[];
  /** QuickBooks' query API has no total-count/cursor — "more likely exists" is inferred from a full page. */
  hasMore: boolean;
}

export interface QuickBooksReportColData {
  value: string;
  id?: string;
}

export interface QuickBooksReportRow {
  type?: string;
  group?: string;
  ColData?: QuickBooksReportColData[];
  Rows?: { Row: QuickBooksReportRow[] };
  Summary?: { ColData: QuickBooksReportColData[] };
  Header?: { ColData: QuickBooksReportColData[] };
}

export interface QuickBooksReport {
  Columns: { Column: { ColTitle: string; ColType: string }[] };
  Rows: { Row: QuickBooksReportRow[] };
}

/**
 * Thin wrapper around QuickBooks' (Intuit) OAuth + accounting Query API
 * endpoints. `realmId` (the connected company id) is required on every
 * accounting call below — callers must pass it through, same as
 * Salesforce's `instanceUrl`.
 */
export class QuickBooksService {
  static getAuthorizationUrl(state: string): string {
    const clientId = process.env.QUICKBOOKS_CLIENT_ID || "";
    const redirectUri =
      process.env.QUICKBOOKS_REDIRECT_URI ||
      "http://localhost:4000/api/v1/integrations/quickbooks/callback";

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: QUICKBOOKS_SCOPES.join(" "),
      state,
    });

    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  /** Intuit authenticates the client via HTTP Basic Auth on the token endpoint, not body params like HubSpot/Salesforce. */
  private static basicAuthHeader(): string {
    const clientId = process.env.QUICKBOOKS_CLIENT_ID || "";
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET || "";
    return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  }

  static async exchangeCodeForToken(code: string): Promise<QuickBooksTokenResponse> {
    try {
      const redirectUri =
        process.env.QUICKBOOKS_REDIRECT_URI ||
        "http://localhost:4000/api/v1/integrations/quickbooks/callback";

      const response = await axios.post(
        TOKEN_URL,
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: this.basicAuthHeader(),
          },
        },
      );
      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in,
      };
    } catch {
      throw AppError.badRequest(
        "Failed to exchange authorization code with QuickBooks",
        "QUICKBOOKS_TOKEN_EXCHANGE_FAILED",
      );
    }
  }

  static async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    try {
      const response = await axios.post(
        TOKEN_URL,
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: this.basicAuthHeader(),
          },
        },
      );
      return {
        accessToken: response.data.access_token,
        expiresIn: response.data.expires_in,
      };
    } catch {
      throw AppError.badRequest(
        "Failed to refresh QuickBooks access token",
        "QUICKBOOKS_TOKEN_REFRESH_FAILED",
      );
    }
  }

  private static async runQuery<T>(
    accessToken: string,
    realmId: string,
    entity: string,
    startPosition: number,
    pageSize: number,
    since?: Date,
  ): Promise<QuickBooksPage<T>> {
    const whereClause = since ? ` WHERE Metadata.LastUpdatedTime >= '${since.toISOString()}'` : "";
    const query = `SELECT * FROM ${entity}${whereClause} STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`;
    const response = await axios.get(`${ACCOUNTING_API_HOST}/v3/company/${realmId}/query`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      params: { query },
    });
    const records: T[] = response.data.QueryResponse?.[entity] ?? [];
    return { records, hasMore: records.length === pageSize };
  }

  /** Fetches a page of Customers — this app's billing-customer entity for QuickBooks (VC-01/VC-02's revenue roll-forward and CM-02's concentration/dedup). */
  static async getCustomers(
    accessToken: string,
    realmId: string,
    startPosition: number,
    pageSize: number,
    since?: Date,
  ): Promise<QuickBooksPage<QuickBooksCustomer>> {
    try {
      return await this.runQuery<QuickBooksCustomer>(accessToken, realmId, "Customer", startPosition, pageSize, since);
    } catch {
      throw AppError.badRequest("Failed to fetch customers from QuickBooks", "QUICKBOOKS_CUSTOMERS_FETCH_FAILED");
    }
  }

  /** Fetches a page of Invoices — the raw material for the customer revenue roll-forward (Shared Building Blocks in the metrics guide). */
  static async getInvoices(
    accessToken: string,
    realmId: string,
    startPosition: number,
    pageSize: number,
    since?: Date,
  ): Promise<QuickBooksPage<QuickBooksInvoice>> {
    try {
      return await this.runQuery<QuickBooksInvoice>(accessToken, realmId, "Invoice", startPosition, pageSize, since);
    } catch {
      throw AppError.badRequest("Failed to fetch invoices from QuickBooks", "QUICKBOOKS_INVOICES_FETCH_FAILED");
    }
  }

  /**
   * Shared GET for any QuickBooks named report — ProfitAndLoss, BalanceSheet, CashFlow,
   * AgedReceivables, AgedPayables, InventoryValuationSummary all share this shape.
   * Retries a 429 up to 4 times (honoring `Retry-After` when QuickBooks sends one, else
   * exponential backoff) — ported from docs/server.js's fetchQuickBooksJson. The per-item
   * P&L sync (one report call per item per quarter) is what actually needed this; applied
   * here so every report call gets it, closing the crm-integrations skill's "no
   * retry/backoff" gap rather than only patching the new call path.
   */
  private static async getReport(
    accessToken: string,
    realmId: string,
    reportName: string,
    params: Record<string, string>,
    errorMessage: string,
    errorCode: string,
    attempt = 0,
  ): Promise<QuickBooksReport> {
    try {
      const response = await axios.get(`${ACCOUNTING_API_HOST}/v3/company/${realmId}/reports/${reportName}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
        params,
      });
      return response.data;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 429 && attempt < 4) {
        const retryAfterHeader = err.response.headers?.["retry-after"];
        const delayMs = retryAfterHeader ? parseFloat(retryAfterHeader) * 1000 : 500 * 2 ** attempt;
        await sleep(delayMs);
        return this.getReport(accessToken, realmId, reportName, params, errorMessage, errorCode, attempt + 1);
      }
      // The thrown AppError only ever carried a generic message (see crm-integrations
      // skill's "no retry/backoff" gap) — log the real cause so a failure is
      // debuggable from server logs instead of a guess.
      if (axios.isAxiosError(err)) {
        console.error(
          `QuickBooks ${reportName} report fetch failed: status=${err.response?.status} body=${JSON.stringify(err.response?.data)}`,
        );
      } else {
        console.error(`QuickBooks ${reportName} report fetch failed:`, err);
      }
      throw AppError.badRequest(errorMessage, errorCode);
    }
  }

  /**
   * Fetches the Profit & Loss report for a date range, optionally summarized
   * by Class/Month and/or filtered to a single Item (Product/Service),
   * Department (Location), and/or one-or-more comma-joined Customer ids —
   * QuickBooks has no native "billing state" report filter, so a state
   * filter resolves to its matching customer ids first (see
   * productRevenueGrowth.service.ts). `summarize_column_by=Class` backs
   * VC-04's Mix %, pulled by the sync job into `PLSnapshot`/`PLItemSnapshot`
   * — never called live at metric-request time for those. `Month` backs the
   * live, on-demand "Revenue growth by product" section
   * (productRevenueGrowth.service.ts) — deliberately NOT pre-synced, since
   * item × department × state is an unbounded, user-chosen combination
   * space; this one mirrors docs/server.js's own live-call design instead.
   */
  static async getProfitAndLossReport(
    accessToken: string,
    realmId: string,
    startDate: string,
    endDate: string,
    summarizeColumnBy: "Total" | "Class" | "Month" = "Total",
    item?: string,
    department?: string,
    customer?: string,
  ): Promise<QuickBooksReport> {
    const params: Record<string, string> = {
      start_date: startDate,
      end_date: endDate,
      summarize_column_by: summarizeColumnBy,
      accounting_method: "Accrual",
    };
    if (item) params.item = item;
    if (department) params.department = department;
    if (customer) params.customer = customer;
    return this.getReport(
      accessToken,
      realmId,
      "ProfitAndLoss",
      params,
      "Failed to fetch Profit & Loss report from QuickBooks",
      "QUICKBOOKS_PROFIT_AND_LOSS_FETCH_FAILED",
    );
  }

  /**
   * Fetches a page of Items (Products/Services) — the raw material for the
   * per-product filter on the VC-04/09/10/13 P&L trend cards. Callers filter
   * to sellable types (`Service`/`Inventory`/`NonInventory`/`Bundle`/`Group`)
   * before using an Item as a report `item` filter — QuickBooks' Reports API
   * rejects the rest (Category/Discount/Payment/Subtotal/Description).
   */
  static async getItems(
    accessToken: string,
    realmId: string,
    startPosition: number,
    pageSize: number,
  ): Promise<QuickBooksPage<QuickBooksItem>> {
    try {
      return await this.runQuery<QuickBooksItem>(accessToken, realmId, "Item", startPosition, pageSize);
    } catch {
      throw AppError.badRequest("Failed to fetch items from QuickBooks", "QUICKBOOKS_ITEMS_FETCH_FAILED");
    }
  }

  /**
   * Fetches Departments (QuickBooks Online's "Location" tracking feature is
   * implemented as the Department entity in the API — there is no separate
   * "Location" object) — the location filter dropdown for "Revenue growth
   * by product". Single page (MAXRESULTS 1000, no pagination loop): this is
   * a live, on-demand lookup for a filter dropdown, not a synced entity, so
   * it matches docs/server.js's own scope rather than the paginated
   * background-sync pattern `getCustomers`/`getInvoices`/`getItems` use.
   */
  static async getDepartments(accessToken: string, realmId: string): Promise<QuickBooksDepartment[]> {
    try {
      const page = await this.runQuery<QuickBooksDepartment>(accessToken, realmId, "Department", 1, 1000);
      return page.records;
    } catch {
      throw AppError.badRequest("Failed to fetch departments from QuickBooks", "QUICKBOOKS_DEPARTMENTS_FETCH_FAILED");
    }
  }

  /**
   * Fetches Customers with their full record (including `BillAddr`, a
   * compound address field QuickBooks' query language can't select by name
   * — `runQuery`'s `SELECT *` already returns it) — resolves a billing-state
   * filter to matching customer ids for `getProfitAndLossReport`'s
   * `customer` param. Single page (MAXRESULTS 1000), same live-lookup scope
   * as `getDepartments` above.
   */
  static async getCustomersWithBillingAddress(accessToken: string, realmId: string): Promise<QuickBooksCustomerWithBillingAddress[]> {
    try {
      const page = await this.runQuery<QuickBooksCustomerWithBillingAddress>(accessToken, realmId, "Customer", 1, 1000);
      return page.records;
    } catch {
      throw AppError.badRequest("Failed to fetch customers from QuickBooks", "QUICKBOOKS_CUSTOMERS_FETCH_FAILED");
    }
  }

  /** Fetches the Balance Sheet as of `asOfDate` — CB-05's bank-account balances (unrestricted cash fallback, per the metrics guide) and CB-07's fallback asset/liability deltas. */
  static async getBalanceSheetReport(accessToken: string, realmId: string, asOfDate: string): Promise<QuickBooksReport> {
    return this.getReport(
      accessToken,
      realmId,
      "BalanceSheet",
      { start_date: asOfDate, end_date: asOfDate },
      "Failed to fetch Balance Sheet report from QuickBooks",
      "QUICKBOOKS_BALANCE_SHEET_FETCH_FAILED",
    );
  }

  /** Fetches the Statement of Cash Flows for a date range — CB-07's operating cash flow and CapEx. */
  static async getCashFlowReport(accessToken: string, realmId: string, startDate: string, endDate: string): Promise<QuickBooksReport> {
    return this.getReport(
      accessToken,
      realmId,
      "CashFlow",
      { start_date: startDate, end_date: endDate },
      "Failed to fetch Cash Flow report from QuickBooks",
      "QUICKBOOKS_CASH_FLOW_FETCH_FAILED",
    );
  }

  /** Fetches the A/R Aging Summary as of `asOfDate` — CB-10's "days to collect" input. */
  static async getAgedReceivablesReport(accessToken: string, realmId: string, asOfDate: string): Promise<QuickBooksReport> {
    return this.getReport(
      accessToken,
      realmId,
      "AgedReceivables",
      { start_date: asOfDate, end_date: asOfDate, report_date: asOfDate },
      "Failed to fetch A/R Aging Summary from QuickBooks",
      "QUICKBOOKS_AGED_RECEIVABLES_FETCH_FAILED",
    );
  }

  /** Fetches the A/P Aging Summary as of `asOfDate` — CB-10's "days to pay" input. */
  static async getAgedPayablesReport(accessToken: string, realmId: string, asOfDate: string): Promise<QuickBooksReport> {
    return this.getReport(
      accessToken,
      realmId,
      "AgedPayables",
      { start_date: asOfDate, end_date: asOfDate, report_date: asOfDate },
      "Failed to fetch A/P Aging Summary from QuickBooks",
      "QUICKBOOKS_AGED_PAYABLES_FETCH_FAILED",
    );
  }

  /** Fetches the Inventory Valuation Summary as of `asOfDate` — CB-10's "days in inventory" input. Service-only companies get an empty report here, which is a display rule (hide the leg), not a data gap — per the metrics guide. */
  static async getInventoryValuationSummaryReport(accessToken: string, realmId: string, asOfDate: string): Promise<QuickBooksReport> {
    return this.getReport(
      accessToken,
      realmId,
      "InventoryValuationSummary",
      { start_date: asOfDate, end_date: asOfDate, report_date: asOfDate },
      "Failed to fetch Inventory Valuation Summary from QuickBooks",
      "QUICKBOOKS_INVENTORY_VALUATION_FETCH_FAILED",
    );
  }
}
