// require("dotenv").config();

// const crypto = require("crypto");
// const express = require("express");

// const app = express();

// const {
//   PORT = 3000,
//   QUICKBOOKS_CLIENT_ID,
//   QUICKBOOKS_CLIENT_SECRET,
//   QUICKBOOKS_REDIRECT_URI,
// } = process.env;

// if (
//   !QUICKBOOKS_CLIENT_ID ||
//   !QUICKBOOKS_CLIENT_SECRET ||
//   !QUICKBOOKS_REDIRECT_URI
// ) {
//   throw new Error("Missing QuickBooks settings in .env");
// }

// const QUICKBOOKS_SANDBOX_URL =
//   "https://sandbox-quickbooks.api.intuit.com";

// // Learning-only: all connections disappear when Node.js stops.
// const connections = new Map();
// let oauthState;

// app.get("/", (req, res) => {
//   res.send(`
// <!DOCTYPE html>
// <html lang="en">
// <head>
//   <meta charset="UTF-8" />
//   <meta name="viewport" content="width=device-width, initial-scale=1.0" />
//   <title>QuickBooks Financial Dashboard</title>
//   <style>
//     * { box-sizing: border-box; }

//     body {
//       margin: 0;
//       min-height: 100vh;
//       font-family: Arial, sans-serif;
//       color: #172b4d;
//       background: #f4f7fb;
//     }

//     header {
//       padding: 40px 24px;
//       color: white;
//       background: linear-gradient(120deg, #1d9b5f, #086a42);
//     }

//     header h1 {
//       max-width: 1100px;
//       margin: 0 auto 8px;
//     }

//     header p {
//       max-width: 1100px;
//       margin: 0 auto;
//       opacity: 0.9;
//     }

//     main {
//       max-width: 1100px;
//       margin: 30px auto;
//       padding: 0 20px;
//     }

//     .card {
//       margin-bottom: 20px;
//       padding: 24px;
//       background: white;
//       border-radius: 12px;
//       box-shadow: 0 5px 20px rgba(23, 43, 77, 0.08);
//     }

//     label {
//       display: block;
//       margin-bottom: 8px;
//       font-weight: bold;
//     }

//     input {
//       width: 100%;
//       margin-bottom: 15px;
//       padding: 12px;
//       border: 1px solid #ccd6e0;
//       border-radius: 7px;
//       font-size: 15px;
//     }

//     .grid {
//       display: grid;
//       grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
//       gap: 12px;
//     }

//     button, .button {
//       padding: 12px 16px;
//       color: white;
//       background: #168a52;
//       border: 0;
//       border-radius: 7px;
//       font: inherit;
//       font-weight: bold;
//       cursor: pointer;
//       text-decoration: none;
//     }

//     button:hover, .button:hover {
//       background: #0e7041;
//     }

//     #status {
//       margin: 16px 0;
//       color: #506784;
//     }

//     #company-details {
//       display: grid;
//       grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
//       gap: 12px;
//     }

//     .detail {
//       padding: 15px;
//       background: #f2faf6;
//       border-radius: 8px;
//     }

//     .detail strong {
//       display: block;
//       margin-bottom: 5px;
//       color: #397554;
//       font-size: 13px;
//     }

//     .table-wrap {
//       overflow-x: auto;
//     }

//     table {
//       width: 100%;
//       border-collapse: collapse;
//     }

//     th, td {
//       padding: 12px;
//       text-align: left;
//       border-bottom: 1px solid #e5ebf2;
//     }

//     th {
//       background: #eef7f2;
//     }

//     .indent-1 { padding-left: 32px; }
//     .indent-2 { padding-left: 55px; }
//     .indent-3 { padding-left: 78px; }

//     .error {
//       padding: 12px;
//       color: #a51d2d;
//       background: #fff0f1;
//       border-radius: 7px;
//     }
//   </style>
// </head>
// <body>
//   <header>
//     <h1>QuickBooks Financial Dashboard</h1>
//     <p>Connect a sandbox company, then view its company profile and financial reports.</p>
//   </header>

//   <main>
//     <section class="card">
//       <h2>1. Connect a company</h2>
//       <p>OAuth gives this app permission to read the QuickBooks company you select.</p>
//       <a class="button" href="/login">Connect QuickBooks Company</a>
//     </section>

//     <section class="card">
//       <h2>2. Choose an authorized company</h2>

//       <label for="realmId">QuickBooks Company ID (realmId)</label>
//       <input
//         id="realmId"
//         placeholder="Connect QuickBooks first, then enter its realmId"
//       />

//       <button onclick="loadCompany()">Load company profile</button>
//       <p id="status">Connect a QuickBooks company to begin.</p>
//       <div id="company-details"></div>
//     </section>

//     <section class="card">
//       <h2>3. Financial statements</h2>

//       <div class="grid">
//         <div>
//           <label for="balanceDate">Balance Sheet date</label>
//           <input id="balanceDate" type="date" />
//           <button onclick="loadBalanceSheet()">View Balance Sheet</button>
//         </div>

//         <div>
//           <label for="cashStartDate">Cash Flow start date</label>
//           <input id="cashStartDate" type="date" />

//           <label for="cashEndDate">Cash Flow end date</label>
//           <input id="cashEndDate" type="date" />

//           <button onclick="loadCashFlow()">View Cash Flow</button>
//         </div>
//       </div>
//     </section>

//     <section class="card">
//       <h2 id="report-title">Report</h2>
//       <div id="report-output">
//         Choose a report to view financial data.
//       </div>
//     </section>
//   </main>

//   <script>
//     const today = new Date().toISOString().slice(0, 10);

//     document.getElementById("balanceDate").value = today;
//     document.getElementById("cashEndDate").value = today;
//     document.getElementById("cashStartDate").value =
//       new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);

//     function getRealmId() {
//       return document.getElementById("realmId").value.trim();
//     }

//     function setStatus(message, isError = false) {
//       const status = document.getElementById("status");
//       status.textContent = message;
//       status.className = isError ? "error" : "";
//     }

//     async function request(path) {
//       const response = await fetch(path);
//       const data = await response.json();

//       if (!response.ok) {
//         throw new Error(data.message || data.Fault?.Error?.[0]?.Message || "Request failed.");
//       }

//       return data;
//     }

//     async function loadCompany() {
//       const companyId = getRealmId();

//       if (!companyId) {
//         return setStatus("Enter a connected company ID (realmId).", true);
//       }

//       try {
//         setStatus("Loading company profile...");
//         const data = await request("/api/company?realmId=" + encodeURIComponent(companyId));
//         const company = data.CompanyInfo;

//         document.getElementById("company-details").innerHTML = "";

//         const details = {
//           "Company Name": company.CompanyName,
//           "Legal Name": company.LegalName,
//           "Country": company.Country,
//           "Email": company.Email?.Address,
//           "Phone": company.PrimaryPhone?.FreeFormNumber,
//         };

//         Object.entries(details).forEach(([label, value]) => {
//           const box = document.createElement("div");
//           box.className = "detail";

//           const heading = document.createElement("strong");
//           heading.textContent = label;

//           const text = document.createElement("span");
//           text.textContent = value || "—";

//           box.append(heading, text);
//           document.getElementById("company-details").appendChild(box);
//         });

//         setStatus("Company profile loaded.");
//       } catch (error) {
//         setStatus(error.message, true);
//       }
//     }

//     function flattenRows(rows, depth = 0) {
//       const result = [];

//       (rows?.Row || []).forEach((row) => {
//         if (row.ColData?.length) {
//           result.push({
//             depth,
//             values: row.ColData.map((column) => column.value || ""),
//           });
//         }

//         if (row.Rows) {
//           result.push(...flattenRows(row.Rows, depth + 1));
//         }
//       });

//       return result;
//     }

//     function renderReport(data, title) {
//       document.getElementById("report-title").textContent = title;

//       const columns = data.Columns?.Column || [];
//       const rows = flattenRows(data.Rows);

//       if (!rows.length) {
//         document.getElementById("report-output").textContent =
//           "QuickBooks returned no report rows for this period.";
//         return;
//       }

//       const table = document.createElement("table");
//       const thead = document.createElement("thead");
//       const headerRow = document.createElement("tr");

//       columns.forEach((column, index) => {
//         const th = document.createElement("th");
//         th.textContent = column.ColTitle || (index === 0 ? "Category" : "Amount");
//         headerRow.appendChild(th);
//       });

//       thead.appendChild(headerRow);
//       table.appendChild(thead);

//       const tbody = document.createElement("tbody");

//       rows.forEach((row) => {
//         const tr = document.createElement("tr");

//         row.values.forEach((value, index) => {
//           const td = document.createElement("td");

//           if (index === 0) {
//             td.className = "indent-" + Math.min(row.depth, 3);
//           }

//           td.textContent = value || "—";
//           tr.appendChild(td);
//         });

//         tbody.appendChild(tr);
//       });

//       table.appendChild(tbody);

//       const wrapper = document.createElement("div");
//       wrapper.className = "table-wrap";
//       wrapper.appendChild(table);

//       const output = document.getElementById("report-output");
//       output.innerHTML = "";
//       output.appendChild(wrapper);
//     }

//     async function loadBalanceSheet() {
//       const companyId = getRealmId();
//       const date = document.getElementById("balanceDate").value;

//       if (!companyId) {
//         return setStatus("Enter a connected company ID (realmId).", true);
//       }

//       try {
//         setStatus("Loading Balance Sheet...");
//         const data = await request(
//           "/api/balance-sheet?realmId=" +
//           encodeURIComponent(companyId) +
//           "&date=" +
//           encodeURIComponent(date)
//         );

//         renderReport(data, "Balance Sheet — " + date);
//         setStatus("Balance Sheet loaded.");
//       } catch (error) {
//         setStatus(error.message, true);
//       }
//     }

//     async function loadCashFlow() {
//       const companyId = getRealmId();
//       const startDate = document.getElementById("cashStartDate").value;
//       const endDate = document.getElementById("cashEndDate").value;

//       if (!companyId) {
//         return setStatus("Enter a connected company ID (realmId).", true);
//       }

//       try {
//         setStatus("Loading Cash Flow Statement...");
//         const data = await request(
//           "/api/cash-flow?realmId=" +
//           encodeURIComponent(companyId) +
//           "&start_date=" +
//           encodeURIComponent(startDate) +
//           "&end_date=" +
//           encodeURIComponent(endDate)
//         );

//         renderReport(
//           data,
//           "Cash Flow Statement — " + startDate + " to " + endDate
//         );

//         setStatus("Cash Flow Statement loaded.");
//       } catch (error) {
//         setStatus(error.message, true);
//       }
//     }
//   </script>
// </body>
// </html>
//   `);
// });

// app.get("/login", (req, res) => {
//   oauthState = crypto.randomUUID();

//   const authorizationUrl = new URL(
//     "https://appcenter.intuit.com/connect/oauth2"
//   );

//   authorizationUrl.searchParams.set("client_id", QUICKBOOKS_CLIENT_ID);
//   authorizationUrl.searchParams.set("response_type", "code");
//   authorizationUrl.searchParams.set(
//     "scope",
//     "com.intuit.quickbooks.accounting"
//   );
//   authorizationUrl.searchParams.set(
//     "redirect_uri",
//     QUICKBOOKS_REDIRECT_URI
//   );
//   authorizationUrl.searchParams.set("state", oauthState);

//   res.redirect(authorizationUrl.toString());
// });

// app.get("/oauth/callback", async (req, res) => {
//   const { code, state, realmId, error } = req.query;

//   if (error) {
//     return res.status(400).send(`QuickBooks authorization failed: ${error}`);
//   }

//   if (!code || !state || state !== oauthState || !realmId) {
//     return res.status(400).send("Invalid QuickBooks OAuth callback.");
//   }

//   try {
//     const basicAuth = Buffer.from(
//       `${QUICKBOOKS_CLIENT_ID}:${QUICKBOOKS_CLIENT_SECRET}`
//     ).toString("base64");

//     const tokenResponse = await fetch(
//       "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
//       {
//         method: "POST",
//         headers: {
//           Authorization: `Basic ${basicAuth}`,
//           "Content-Type": "application/x-www-form-urlencoded",
//           Accept: "application/json",
//         },
//         body: new URLSearchParams({
//           grant_type: "authorization_code",
//           code,
//           redirect_uri: QUICKBOOKS_REDIRECT_URI,
//         }),
//       }
//     );

//     const tokens = await tokenResponse.json();

//     if (!tokenResponse.ok) {
//       console.error("QuickBooks token error:", tokens.error);
//       return res.status(500).send("Could not exchange authorization code.");
//     }

//     connections.set(realmId, {
//       accessToken: tokens.access_token,
//       refreshToken: tokens.refresh_token,
//     });

//     console.log("QuickBooks company connected:", realmId);

//     oauthState = undefined;
//     res.redirect("/");
//   } catch (error) {
//     console.error(error.message);
//     res.status(500).send("Unexpected server error.");
//   }
// });

// function getConnection(req, res) {
//   const requestedRealmId = req.query.realmId;

//   if (!requestedRealmId) {
//     res.status(400).json({ message: "Enter a QuickBooks company ID (realmId)." });
//     return null;
//   }

//   const connection = connections.get(requestedRealmId);

//   if (!connection) {
//     res.status(401).json({
//       message:
//         "This company is not connected. Click Connect QuickBooks Company and authorize this company first.",
//     });
//     return null;
//   }

//   return {
//     realmId: requestedRealmId,
//     accessToken: connection.accessToken,
//   };
// }

// async function fetchQuickBooks(url, accessToken, res) {
//   try {
//     const response = await fetch(url, {
//       headers: {
//         Authorization: `Bearer ${accessToken}`,
//         Accept: "application/json",
//       },
//     });

//     const data = await response.json();

//     if (!response.ok) {
//       return res.status(response.status).json(data);
//     }

//     res.json(data);
//   } catch (error) {
//     console.error(error.message);
//     res.status(500).json({ message: "Could not fetch QuickBooks data." });
//   }
// }

// app.get("/api/company", (req, res) => {
//   const connection = getConnection(req, res);
//   if (!connection) return;

//   const url =
//     `${QUICKBOOKS_SANDBOX_URL}/v3/company/` +
//     `${connection.realmId}/companyinfo/${connection.realmId}`;

//   fetchQuickBooks(url, connection.accessToken, res);
// });

// app.get("/api/balance-sheet", (req, res) => {
//   const connection = getConnection(req, res);
//   if (!connection) return;

//   const url = new URL(
//     `${QUICKBOOKS_SANDBOX_URL}/v3/company/` +
//     `${connection.realmId}/reports/BalanceSheet`
//   );

//   url.searchParams.set(
//     "date",
//     req.query.date || new Date().toISOString().slice(0, 10)
//   );

//   fetchQuickBooks(url, connection.accessToken, res);
// });

// app.get("/api/cash-flow", (req, res) => {
//   const connection = getConnection(req, res);
//   if (!connection) return;

//   const url = new URL(
//     `${QUICKBOOKS_SANDBOX_URL}/v3/company/` +
//     `${connection.realmId}/reports/CashFlow`
//   );

//   url.searchParams.set("start_date", req.query.start_date || "2026-01-01");
//   url.searchParams.set(
//     "end_date",
//     req.query.end_date || new Date().toISOString().slice(0, 10)
//   );

//   fetchQuickBooks(url, connection.accessToken, res);
// });

// app.listen(PORT, () => {
//   console.log(`Open http://localhost:${PORT}`);
// });




require("dotenv").config();

const crypto = require("crypto");
const express = require("express");

const app = express();

const {
  PORT = 3000,
  QUICKBOOKS_CLIENT_ID,
  QUICKBOOKS_CLIENT_SECRET,
  QUICKBOOKS_REDIRECT_URI,
} = process.env;

if (
  !QUICKBOOKS_CLIENT_ID ||
  !QUICKBOOKS_CLIENT_SECRET ||
  !QUICKBOOKS_REDIRECT_URI
) {
  throw new Error("Missing QuickBooks settings in .env");
}

const QUICKBOOKS_SANDBOX_URL =
  "https://sandbox-quickbooks.api.intuit.com";

// Learning-only: all connections disappear when Node.js stops.
const connections = new Map();
let oauthState;

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>QuickBooks Financial Dashboard</title>
  <style>
    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: Arial, sans-serif;
      color: #172b4d;
      background: #f4f7fb;
    }

    header {
      padding: 40px 24px;
      color: white;
      background: linear-gradient(120deg, #1d9b5f, #086a42);
    }

    header h1 {
      max-width: 1100px;
      margin: 0 auto 8px;
    }

    header p {
      max-width: 1100px;
      margin: 0 auto;
      opacity: 0.9;
    }

    main {
      max-width: 1100px;
      margin: 30px auto;
      padding: 0 20px;
    }

    .card {
      margin-bottom: 20px;
      padding: 24px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 5px 20px rgba(23, 43, 77, 0.08);
    }

    label {
      display: block;
      margin-bottom: 8px;
      font-weight: bold;
    }

    input {
      width: 100%;
      margin-bottom: 15px;
      padding: 12px;
      border: 1px solid #ccd6e0;
      border-radius: 7px;
      font-size: 15px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 12px;
    }

    button, .button {
      padding: 12px 16px;
      color: white;
      background: #168a52;
      border: 0;
      border-radius: 7px;
      font: inherit;
      font-weight: bold;
      cursor: pointer;
      text-decoration: none;
    }

    button:hover, .button:hover {
      background: #0e7041;
    }

    #status {
      margin: 16px 0;
      color: #506784;
    }

    #company-details {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 12px;
    }

    .detail {
      padding: 15px;
      background: #f2faf6;
      border-radius: 8px;
    }

    .detail strong {
      display: block;
      margin-bottom: 5px;
      color: #397554;
      font-size: 13px;
    }

    .table-wrap {
      overflow-x: auto;
    }

    .toolbar {
      display: flex;
      align-items: flex-end;
      gap: 16px;
      flex-wrap: wrap;
    }

    .toolbar input {
      width: 8rem;
      margin-bottom: 0;
    }

    .toolbar button {
      margin-bottom: 15px;
    }

    .radio-group {
      display: flex;
      gap: 12px;
      margin-bottom: 15px;
    }

    .radio-option {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: normal;
      margin-bottom: 0;
      white-space: nowrap;
    }

    .radio-option input {
      width: auto;
      margin-bottom: 0;
    }

    .status-line {
      color: #506784;
      font-size: 14px;
      min-height: 1.2em;
    }

    .chart-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
      gap: 16px;
      margin: 16px 0;
    }

    .chart-card {
      padding: 18px 18px 12px;
      background: #f7faf9;
      border: 1px solid #e5ebf2;
      border-radius: 10px;
    }

    .chart-card h3 {
      margin: 0 0 4px;
      font-size: 14px;
      color: #33475b;
    }

    .chart-card .chart-subtitle {
      margin: 0 0 12px;
      font-size: 12px;
      color: #7c8aa0;
    }

    .chart-scroll {
      overflow-x: auto;
    }

    .chart-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      margin: 0 0 12px;
    }

    .chart-legend-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: #33475b;
    }

    .chart-legend-swatch {
      width: 10px;
      height: 10px;
      border-radius: 2px;
      flex-shrink: 0;
    }

    details {
      margin-top: 16px;
    }

    summary {
      cursor: pointer;
      font-weight: bold;
      color: #168a52;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #e5ebf2;
    }

    th {
      background: #eef7f2;
    }

    .indent-1 { padding-left: 32px; }
    .indent-2 { padding-left: 55px; }
    .indent-3 { padding-left: 78px; }

    .error {
      padding: 12px;
      color: #a51d2d;
      background: #fff0f1;
      border-radius: 7px;
    }

    .section-block {
      margin-bottom: 28px;
    }

    .section-block:last-child {
      margin-bottom: 0;
    }

    .section-title {
      margin: 0 0 10px;
      padding-bottom: 8px;
      color: #397554;
      font-size: 16px;
      border-bottom: 2px solid #cfe8da;
    }

    .total-row td {
      font-weight: bold;
      background: #f2faf6;
      border-top: 2px solid #cfe8da;
    }

    .grand-total-row td {
      font-weight: bold;
      background: #e8f5ee;
      border-top: 2px solid #9fd3b6;
    }
  </style>
</head>
<body>
  <header>
    <h1>QuickBooks Financial Dashboard</h1>
    <p>Connect a sandbox company, then view its company profile and financial reports.</p>
  </header>

  <main>
    <section class="card">
      <h2>1. Connect a company</h2>
      <p>OAuth gives this app permission to read the QuickBooks company you select.</p>
      <a class="button" href="/login">Connect QuickBooks Company</a>
    </section>

    <section class="card">
      <h2>2. Choose an authorized company</h2>

      <label for="realmId">QuickBooks Company ID (realmId)</label>
      <input
        id="realmId"
        placeholder="Connect QuickBooks first, then enter its realmId"
      />

      <button onclick="loadCompany()">Load company profile</button>
      <p id="status">Connect a QuickBooks company to begin.</p>
      <div id="company-details"></div>
    </section>

    <section class="card">
      <h2>3. Financial statements</h2>

      <div>
        <label for="productFilter">Filter by product/service (optional)</label>
        <select id="productFilter">
          <option value="">All products</option>
        </select>
        <button onclick="loadProducts()">Load products</button>
      </div>

      <div class="grid">
        <div>
          <label for="balanceDate">Balance Sheet date</label>
          <input id="balanceDate" type="date" />
          <button onclick="loadBalanceSheet()">View Balance Sheet</button>
        </div>

        <div>
          <label for="cashStartDate">Cash Flow start date</label>
          <input id="cashStartDate" type="date" />

          <label for="cashEndDate">Cash Flow end date</label>
          <input id="cashEndDate" type="date" />

          <button onclick="loadCashFlow()">View Cash Flow</button>
        </div>

        <div>
          <label for="plStartDate">Profit &amp; Loss start date</label>
          <input id="plStartDate" type="date" />

          <label for="plEndDate">Profit &amp; Loss end date</label>
          <input id="plEndDate" type="date" />

          <button onclick="loadProfitAndLoss()">View Profit &amp; Loss</button>
        </div>
      </div>

      <button onclick="loadAllStatements()">View All Statements</button>
      <p>
        "View All Statements" uses the Balance Sheet date above together
        with the Cash Flow start/end dates for both the Cash Flow and
        Profit &amp; Loss periods.
      </p>
    </section>

    <section class="card">
      <h2>4. Monthly performance trends</h2>
      <p>
        Revenue growth, EBITDA margin, COGS % of revenue, and G&amp;A % of
        revenue, one bar per completed calendar month. The current
        (in-progress) month is always excluded.
      </p>

      <div class="toolbar">
        <div>
          <label for="trendsFromYear">From year</label>
          <input id="trendsFromYear" type="number" min="2000" max="2100" step="1" />
        </div>
        <div>
          <label for="trendsProductFilter">Product</label>
          <select id="trendsProductFilter" onchange="loadTrends()">
            <option value="">All products</option>
          </select>
        </div>
        <button onclick="loadTrends()">Load Trends</button>
      </div>
      <p id="trends-status" class="status-line"></p>

      <div id="trend-charts" class="chart-grid"></div>

      <details id="trend-table-details" style="display: none;">
        <summary>View as table</summary>
        <div id="trend-table"></div>
      </details>
    </section>

    <section class="card">
      <h2>5. Revenue growth by product</h2>
      <p>
        Same month-over-month revenue growth metric as above, for a single
        product/service, or all of them together for comparison, optionally
        filtered to one location and/or one customer billing-address state.
        Uses the "From year" setting above. The chart scrolls horizontally
        if there are many months. If your company doesn't use QuickBooks'
        location tracking, the location dropdown will just show "All
        locations".
      </p>

      <div class="toolbar">
        <button onclick="loadProductRevenueGrowth()">Load Product Revenue Growth</button>
        <div>
          <label for="productRevenueSelect">Product</label>
          <select id="productRevenueSelect" onchange="renderProductRevenueChart()" disabled>
            <option value="">All products</option>
          </select>
        </div>
        <div>
          <label for="productRevenueLocationSelect">Location</label>
          <select id="productRevenueLocationSelect" onchange="loadProductRevenueGrowth()">
            <option value="">All locations</option>
          </select>
        </div>
        <div>
          <label for="productRevenueStateSelect">Billing state</label>
          <select id="productRevenueStateSelect" onchange="loadProductRevenueGrowth()">
            <option value="">All states</option>
          </select>
        </div>
        <div>
          <label>View</label>
          <div class="radio-group">
            <label class="radio-option">
              <input type="radio" name="productRevenueMetric" value="percentage" checked onchange="renderProductRevenueChart()" />
              Percentage
            </label>
            <label class="radio-option">
              <input type="radio" name="productRevenueMetric" value="absolute" onchange="renderProductRevenueChart()" />
              Absolute revenue
            </label>
          </div>
        </div>
      </div>
      <p id="product-trends-status" class="status-line"></p>

      <div id="product-trend-charts" class="chart-grid"></div>
    </section>

    <section class="card">
      <h2>6. Customer concentration</h2>
      <p>
        Share of monthly revenue held by your top customers — e.g. "in Jan
        2018 the top 3 customers held 30% of revenue." Uses the "From year"
        setting from section 4.
      </p>

      <div class="toolbar">
        <button onclick="loadCustomerConcentration()">Load Customer Concentration</button>
        <div>
          <label for="topCustomerCount">Top N customers</label>
          <input id="topCustomerCount" type="number" min="1" max="50" step="1" value="3" oninput="renderCustomerConcentrationChart()" />
        </div>
      </div>
      <p id="customer-concentration-status" class="status-line"></p>

      <div id="customer-concentration-charts" class="chart-grid"></div>
    </section>

    <section class="card">
      <h2 id="report-title">Report</h2>
      <div id="report-output">
        Choose a report to view financial data.
      </div>
    </section>
  </main>

  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
  <script>
    const today = new Date().toISOString().slice(0, 10);

    document.getElementById("balanceDate").value = today;
    document.getElementById("cashEndDate").value = today;
    document.getElementById("cashStartDate").value =
      new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
    document.getElementById("plEndDate").value = today;
    document.getElementById("plStartDate").value =
      new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
    document.getElementById("trendsFromYear").value = 2018;

    function getRealmId() {
      return document.getElementById("realmId").value.trim();
    }

    function getProductFilter() {
      return document.getElementById("productFilter").value;
    }

    function setStatus(message, isError = false) {
      const status = document.getElementById("status");
      status.textContent = message;
      status.className = isError ? "error" : "";
    }

    async function request(path) {
      const response = await fetch(path);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.Fault?.Error?.[0]?.Message || "Request failed.");
      }

      return data;
    }

    async function loadCompany() {
      const companyId = getRealmId();

      if (!companyId) {
        return setStatus("Enter a connected company ID (realmId).", true);
      }

      try {
        setStatus("Loading company profile...");
        const data = await request("/api/company?realmId=" + encodeURIComponent(companyId));
        const company = data.CompanyInfo;

        document.getElementById("company-details").innerHTML = "";

        const details = {
          "Company Name": company.CompanyName,
          "Legal Name": company.LegalName,
          "Country": company.Country,
          "Email": company.Email?.Address,
          "Phone": company.PrimaryPhone?.FreeFormNumber,
        };

        Object.entries(details).forEach(([label, value]) => {
          const box = document.createElement("div");
          box.className = "detail";

          const heading = document.createElement("strong");
          heading.textContent = label;

          const text = document.createElement("span");
          text.textContent = value || "—";

          box.append(heading, text);
          document.getElementById("company-details").appendChild(box);
        });

        setStatus("Company profile loaded.");
      } catch (error) {
        setStatus(error.message, true);
      }
    }

    function flattenRows(rows, depth = 0) {
      const result = [];

      (rows?.Row || []).forEach((row) => {
        if (row.ColData?.length) {
          result.push({
            depth,
            values: row.ColData.map((column) => column.value || ""),
          });
        }

        if (row.Rows) {
          result.push(...flattenRows(row.Rows, depth + 1));
        }
      });

      return result;
    }

    // QuickBooks doesn't label the three sections the same way. Liabilities
    // and Equity are nested as two labeled sub-groups inside a
    // "LiabilitiesAndEquity" wrapper, but Assets has no such inner
    // "Assets" sub-group — the wrapper itself (group "TotalAssets") *is*
    // the section. So each section is matched either by its own group
    // name or by its "TotalX" wrapper / header text.
    function matchesSection(row, name) {
      const group = (row.group || "").toLowerCase();
      const header = (row.Header?.ColData?.[0]?.value || "").trim().toLowerCase();

      if (name === "assets") {
        return group === "assets" || group === "totalassets" || header === "assets";
      }
      if (name === "liabilities") {
        return group === "liabilities" || group === "totalliabilities" || header === "liabilities";
      }
      if (name === "equity") {
        return group === "equity" || group === "totalequity" || header === "equity";
      }
      return false;
    }

    // Walks the full row tree and pulls out the top-level Assets,
    // Liabilities, and Equity sections. Stops descending into a row once
    // it has been claimed as a section (it's a leaf we already want to
    // render whole); otherwise keeps recursing to find nested sections
    // like Liabilities/Equity inside the LiabilitiesAndEquity wrapper.
    function collectBalanceSections(rows) {
      const sections = {};

      function walk(rowsObj) {
        (rowsObj?.Row || []).forEach((row) => {
          let matched = false;

          ["assets", "liabilities", "equity"].forEach((name) => {
            if (!sections[name] && matchesSection(row, name)) {
              sections[name] = row;
              matched = true;
            }
          });

          if (!matched && row.Rows) {
            walk(row.Rows);
          }
        });
      }

      walk(rows);
      return sections;
    }

    function buildBalanceTable(rows) {
      const table = document.createElement("table");
      const tbody = document.createElement("tbody");

      rows.forEach((row) => {
        const tr = document.createElement("tr");
        if (row.isTotal) tr.className = "total-row";

        row.values.forEach((value, index) => {
          const td = document.createElement("td");

          if (index === 0 && !row.isTotal) {
            td.className = "indent-" + Math.min(row.depth, 3);
          }

          td.textContent = value || "—";
          tr.appendChild(td);
        });

        tbody.appendChild(tr);
      });

      table.appendChild(tbody);

      const wrapper = document.createElement("div");
      wrapper.className = "table-wrap";
      wrapper.appendChild(table);
      return wrapper;
    }

    // Renders one section (Assets / Liabilities / Equity) as its own
    // titled block, with the section's total appended as a bold row.
    function buildSectionBlock(sectionRow) {
      const block = document.createElement("div");
      block.className = "section-block";

      const heading = document.createElement("h3");
      heading.className = "section-title";
      heading.textContent = sectionRow.Header?.ColData?.[0]?.value || "";
      block.appendChild(heading);

      const rows = flattenRows(sectionRow.Rows);

      if (sectionRow.Summary?.ColData?.length) {
        rows.push({
          depth: 0,
          isTotal: true,
          values: sectionRow.Summary.ColData.map((column) => column.value || ""),
        });
      }

      if (!rows.length) {
        const empty = document.createElement("p");
        empty.textContent = "No rows for this section.";
        block.appendChild(empty);
        return block;
      }

      block.appendChild(buildBalanceTable(rows));
      return block;
    }

    function renderBalanceSheet(data, title, container) {
      const output = container || document.getElementById("report-output");

      if (!container) {
        document.getElementById("report-title").textContent = title;
        output.innerHTML = "";
      }

      const sections = collectBalanceSections(data.Rows);

      if (!sections.assets && !sections.liabilities && !sections.equity) {
        const empty = document.createElement("p");
        empty.textContent = "QuickBooks returned no report rows for this period.";
        output.appendChild(empty);
        return;
      }

      if (sections.assets) output.appendChild(buildSectionBlock(sections.assets));
      if (sections.liabilities) output.appendChild(buildSectionBlock(sections.liabilities));
      if (sections.equity) output.appendChild(buildSectionBlock(sections.equity));

      // Grand total row: Total Liabilities and Equity, if QuickBooks
      // included it at the top level alongside Assets.
      const grandTotal = (data.Rows?.Row || []).find(
        (row) => (row.group || "").toLowerCase() === "totalliabilitiesandequity"
      );

      if (grandTotal?.Summary?.ColData?.length) {
        const block = document.createElement("div");
        block.className = "section-block";

        const table = buildBalanceTable([
          {
            depth: 0,
            isTotal: true,
            values: grandTotal.Summary.ColData.map((column) => column.value || ""),
          },
        ]);

        table.querySelector("tr").className = "grand-total-row";
        block.appendChild(table);
        output.appendChild(block);
      }
    }

    function renderReport(data, title, container) {
      const output = container || document.getElementById("report-output");

      if (!container) {
        document.getElementById("report-title").textContent = title;
      }

      const columns = data.Columns?.Column || [];
      const rows = flattenRows(data.Rows);

      if (!rows.length) {
        const empty = document.createElement("p");
        empty.textContent = "QuickBooks returned no report rows for this period.";
        if (!container) output.innerHTML = "";
        output.appendChild(empty);
        return;
      }

      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");

      columns.forEach((column, index) => {
        const th = document.createElement("th");
        th.textContent = column.ColTitle || (index === 0 ? "Category" : "Amount");
        headerRow.appendChild(th);
      });

      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");

      rows.forEach((row) => {
        const tr = document.createElement("tr");

        row.values.forEach((value, index) => {
          const td = document.createElement("td");

          if (index === 0) {
            td.className = "indent-" + Math.min(row.depth, 3);
          }

          td.textContent = value || "—";
          tr.appendChild(td);
        });

        tbody.appendChild(tr);
      });

      table.appendChild(tbody);

      const wrapper = document.createElement("div");
      wrapper.className = "table-wrap";
      wrapper.appendChild(table);

      if (!container) output.innerHTML = "";
      output.appendChild(wrapper);
    }

    async function loadBalanceSheet() {
      const companyId = getRealmId();
      const date = document.getElementById("balanceDate").value;

      if (!companyId) {
        return setStatus("Enter a connected company ID (realmId).", true);
      }

      try {
        setStatus("Loading Balance Sheet...");
        const params = new URLSearchParams({ realmId: companyId, date });
        const item = getProductFilter();
        if (item) params.set("item", item);

        const data = await request("/api/balance-sheet?" + params.toString());

        renderBalanceSheet(data, "Balance Sheet — " + date);
        setStatus("Balance Sheet loaded.");
      } catch (error) {
        setStatus(error.message, true);
      }
    }

    async function loadCashFlow() {
      const companyId = getRealmId();
      const startDate = document.getElementById("cashStartDate").value;
      const endDate = document.getElementById("cashEndDate").value;

      if (!companyId) {
        return setStatus("Enter a connected company ID (realmId).", true);
      }

      try {
        setStatus("Loading Cash Flow Statement...");
        const params = new URLSearchParams({
          realmId: companyId,
          start_date: startDate,
          end_date: endDate,
        });
        const item = getProductFilter();
        if (item) params.set("item", item);

        const data = await request("/api/cash-flow?" + params.toString());

        renderReport(
          data,
          "Cash Flow Statement — " + startDate + " to " + endDate
        );

        setStatus("Cash Flow Statement loaded.");
      } catch (error) {
        setStatus(error.message, true);
      }
    }

    async function loadProfitAndLoss() {
      const companyId = getRealmId();
      const startDate = document.getElementById("plStartDate").value;
      const endDate = document.getElementById("plEndDate").value;

      if (!companyId) {
        return setStatus("Enter a connected company ID (realmId).", true);
      }

      try {
        setStatus("Loading Profit & Loss Statement...");
        const params = new URLSearchParams({
          realmId: companyId,
          start_date: startDate,
          end_date: endDate,
        });
        const item = getProductFilter();
        if (item) params.set("item", item);

        const data = await request("/api/profit-loss?" + params.toString());

        renderReport(
          data,
          "Profit & Loss Statement — " + startDate + " to " + endDate
        );

        setStatus("Profit & Loss Statement loaded.");
      } catch (error) {
        setStatus(error.message, true);
      }
    }

    async function loadProducts() {
      const companyId = getRealmId();

      if (!companyId) {
        return setStatus("Enter a connected company ID (realmId).", true);
      }

      try {
        setStatus("Loading products...");
        const data = await request(
          "/api/products?realmId=" + encodeURIComponent(companyId)
        );
        const items = data.QueryResponse?.Item || [];

        const select = document.getElementById("productFilter");
        select.innerHTML = '<option value="">All products</option>';

        items.forEach((item) => {
          const option = document.createElement("option");
          option.value = item.Id;
          option.textContent = item.Name;
          select.appendChild(option);
        });

        setStatus(
          items.length
            ? "Products loaded."
            : "No products found for this company."
        );
      } catch (error) {
        setStatus(error.message, true);
      }
    }

    async function loadAllStatements() {
      const companyId = getRealmId();
      const date = document.getElementById("balanceDate").value;
      const startDate = document.getElementById("cashStartDate").value;
      const endDate = document.getElementById("cashEndDate").value;

      if (!companyId) {
        return setStatus("Enter a connected company ID (realmId).", true);
      }

      try {
        setStatus("Loading all statements...");
        const params = new URLSearchParams({
          realmId: companyId,
          date,
          start_date: startDate,
          end_date: endDate,
        });
        const item = getProductFilter();
        if (item) params.set("item", item);

        const data = await request("/api/all-statements?" + params.toString());

        document.getElementById("report-title").textContent = "All Statements";
        const output = document.getElementById("report-output");
        output.innerHTML = "";

        const addHeading = (text) => {
          const heading = document.createElement("h3");
          heading.textContent = text;
          output.appendChild(heading);
        };

        addHeading("Balance Sheet — " + date);
        renderBalanceSheet(data.balanceSheet, null, output);

        addHeading("Cash Flow Statement — " + startDate + " to " + endDate);
        renderReport(data.cashFlow, null, output);

        addHeading("Profit & Loss Statement — " + startDate + " to " + endDate);
        renderReport(data.profitLoss, null, output);

        setStatus("All statements loaded.");
      } catch (error) {
        setStatus(error.message, true);
      }
    }

    const trendChartInstances = [];
    const productChartInstances = [];

    function destroyCharts(registry) {
      registry.forEach((chart) => chart.destroy());
      registry.length = 0;
    }

    // Renders one metric as a Chart.js bar chart. "points" is
    // [{ label, value }], where value may be null for months with no
    // comparable prior data (e.g. the first month's revenue growth) — those
    // render as gaps rather than zero-height bars. Created chart instances
    // are pushed onto "registry" so a later reload can destroy them first.
    function renderBarChart(container, title, subtitle, points, color, registry) {
      const formatValue = (v) => (v === null || v === undefined ? "—" : v.toFixed(1) + "%");

      const wrapper = document.createElement("div");
      wrapper.className = "chart-card";

      const heading = document.createElement("h3");
      heading.textContent = title;
      wrapper.appendChild(heading);

      if (subtitle) {
        const sub = document.createElement("p");
        sub.className = "chart-subtitle";
        sub.textContent = subtitle;
        wrapper.appendChild(sub);
      }

      const hasData = points.some(
        (p) => p.value !== null && p.value !== undefined && !Number.isNaN(p.value)
      );

      if (!hasData) {
        const empty = document.createElement("p");
        empty.textContent = "No data available for this range.";
        wrapper.appendChild(empty);
        container.appendChild(wrapper);
        return;
      }

      const scrollWrap = document.createElement("div");
      scrollWrap.className = "chart-scroll";

      const canvasWidth = Math.max(360, points.length * 34);
      const canvas = document.createElement("canvas");
      canvas.width = canvasWidth;
      canvas.height = 260;
      canvas.style.width = canvasWidth + "px";
      canvas.style.height = "260px";
      scrollWrap.appendChild(canvas);
      wrapper.appendChild(scrollWrap);
      container.appendChild(wrapper);

      const chart = new Chart(canvas.getContext("2d"), {
        type: "bar",
        data: {
          labels: points.map((p) => p.label),
          datasets: [
            {
              label: title,
              data: points.map((p) => p.value),
              backgroundColor: color,
              borderRadius: 4,
              borderSkipped: false,
              maxBarThickness: 22,
            },
          ],
        },
        options: {
          responsive: false,
          animation: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => formatValue(ctx.parsed.y),
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 12 },
            },
            y: {
              grid: { color: "#e1e0d9" },
              ticks: { callback: (v) => formatValue(v) },
            },
          },
        },
      });

      registry.push(chart);
    }

    // Fixed color order for multi-series charts (one hue per product).
    const seriesPalette = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];

    // Like renderBarChart, but for one or more named series sharing the same
    // month labels. A legend is shown only when there's more than one
    // series — a single series names itself via the chart title.
    const formatPercentValue = (v) => (v === null || v === undefined ? "—" : v.toFixed(1) + "%");
    const formatCurrencyValue = (v) =>
      v === null || v === undefined
        ? "—"
        : v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

    // "tooltipAfterBody(monthIndex)" is optional — when given, it returns
    // extra lines appended to that month's tooltip (used to break down the
    // customer-concentration chart's percentage into named customers).
    function renderMultiSeriesBarChart(container, title, subtitle, labels, series, registry, formatValue, tooltipAfterBody) {
      formatValue = formatValue || formatPercentValue;

      const wrapper = document.createElement("div");
      wrapper.className = "chart-card";

      const heading = document.createElement("h3");
      heading.textContent = title;
      wrapper.appendChild(heading);

      if (subtitle) {
        const sub = document.createElement("p");
        sub.className = "chart-subtitle";
        sub.textContent = subtitle;
        wrapper.appendChild(sub);
      }

      const hasData = series.some((s) =>
        s.values.some((v) => v !== null && v !== undefined && !Number.isNaN(v))
      );

      if (!hasData) {
        const empty = document.createElement("p");
        empty.textContent = "No data available for this range.";
        wrapper.appendChild(empty);
        container.appendChild(wrapper);
        return;
      }

      // A Chart.js canvas-drawn legend is positioned inside the canvas, so
      // on a very wide (horizontally scrolling) chart it can render off to
      // one side and scroll out of view. Build a plain HTML legend instead,
      // outside the scrolling area, so it always stays visible.
      if (series.length > 1) {
        const legend = document.createElement("div");
        legend.className = "chart-legend";
        series.forEach((s, index) => {
          const item = document.createElement("span");
          item.className = "chart-legend-item";
          const swatch = document.createElement("span");
          swatch.className = "chart-legend-swatch";
          swatch.style.backgroundColor = s.color || seriesPalette[index % seriesPalette.length];
          item.appendChild(swatch);
          item.appendChild(document.createTextNode(s.name));
          legend.appendChild(item);
        });
        wrapper.appendChild(legend);
      }

      const scrollWrap = document.createElement("div");
      scrollWrap.className = "chart-scroll";

      const perMonthWidth = series.length > 1 ? 50 : 34;
      const canvasWidth = Math.max(360, labels.length * perMonthWidth);
      const canvasHeight = 260;
      const canvas = document.createElement("canvas");
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      canvas.style.width = canvasWidth + "px";
      canvas.style.height = canvasHeight + "px";
      scrollWrap.appendChild(canvas);
      wrapper.appendChild(scrollWrap);
      container.appendChild(wrapper);

      const chart = new Chart(canvas.getContext("2d"), {
        type: "bar",
        data: {
          labels,
          datasets: series.map((s, index) => ({
            label: s.name,
            data: s.values,
            backgroundColor: s.color || seriesPalette[index % seriesPalette.length],
            borderRadius: 4,
            borderSkipped: false,
            maxBarThickness: series.length > 1 ? 10 : 22,
          })),
        },
        options: {
          responsive: false,
          animation: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => ctx.dataset.label + ": " + formatValue(ctx.parsed.y),
                afterBody: tooltipAfterBody
                  ? (items) => tooltipAfterBody(items[0].dataIndex)
                  : undefined,
              },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { maxRotation: 0, autoSkip: true, autoSkipPadding: 12 },
            },
            y: {
              grid: { color: "#e1e0d9" },
              ticks: { callback: (v) => formatValue(v) },
            },
          },
        },
      });

      registry.push(chart);
    }

    function buildTrendTable(months) {
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      thead.innerHTML =
        "<tr><th>Month</th><th>Revenue</th><th>Revenue growth %</th>" +
        "<th>COGS % of revenue</th><th>G&amp;A % of revenue</th><th>EBITDA margin %</th></tr>";
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      const fmtPct = (v) => (v === null ? "—" : v.toFixed(1) + "%");
      const fmtMoney = (v) =>
        v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

      months.forEach((m) => {
        const tr = document.createElement("tr");
        tr.innerHTML =
          "<td>" + m.month + "</td><td>" + fmtMoney(m.revenue) + "</td>" +
          "<td>" + fmtPct(m.revenueGrowthPct) + "</td><td>" + fmtPct(m.cogsPct) + "</td>" +
          "<td>" + fmtPct(m.gaPct) + "</td><td>" + fmtPct(m.ebitdaMarginPct) + "</td>";
        tbody.appendChild(tr);
      });

      table.appendChild(tbody);

      const wrapper = document.createElement("div");
      wrapper.className = "table-wrap";
      wrapper.appendChild(table);
      return wrapper;
    }

    async function loadTrends() {
      const companyId = getRealmId();
      const fromYear = document.getElementById("trendsFromYear").value || 2018;
      const productSelect = document.getElementById("trendsProductFilter");

      if (!companyId) {
        return setStatus("Enter a connected company ID (realmId).", true);
      }

      const status = document.getElementById("trends-status");

      try {
        status.textContent = "Loading monthly trends... this can take a moment for a wide date range.";
        status.className = "";

        if (productSelect.options.length <= 1) {
          const productsData = await request(
            "/api/products?realmId=" + encodeURIComponent(companyId)
          );
          const items = productsData.QueryResponse?.Item || [];
          items.forEach((item) => {
            const option = document.createElement("option");
            option.value = item.Id;
            option.textContent = item.Name;
            productSelect.appendChild(option);
          });
        }

        const selectedProductId = productSelect.value;
        const selectedProductName = selectedProductId
          ? productSelect.options[productSelect.selectedIndex].textContent
          : "";

        const params = new URLSearchParams({
          realmId: companyId,
          start_date: fromYear + "-01-01",
        });
        if (selectedProductId) params.set("item", selectedProductId);

        const data = await request("/api/monthly-metrics?" + params.toString());
        const months = data.months || [];

        const chartsContainer = document.getElementById("trend-charts");
        destroyCharts(trendChartInstances);
        chartsContainer.innerHTML = "";

        if (!months.length) {
          status.textContent = "No monthly data found for this range.";
          document.getElementById("trend-table-details").style.display = "none";
          return;
        }

        const toPoints = (key) => months.map((m) => ({ label: m.month, value: m[key] }));
        const titleSuffix = selectedProductName ? " — " + selectedProductName : "";

        renderBarChart(chartsContainer, "Revenue growth %" + titleSuffix, "Month over month", toPoints("revenueGrowthPct"), "#2a78d6", trendChartInstances);
        renderBarChart(chartsContainer, "EBITDA margin %" + titleSuffix, "Net operating income + D&A, as % of revenue", toPoints("ebitdaMarginPct"), "#1baf7a", trendChartInstances);
        renderBarChart(chartsContainer, "COGS % of revenue" + titleSuffix, null, toPoints("cogsPct"), "#eb6834", trendChartInstances);
        renderBarChart(chartsContainer, "G&A % of revenue" + titleSuffix, "Approximated as total operating expenses", toPoints("gaPct"), "#4a3aa7", trendChartInstances);

        const tableContainer = document.getElementById("trend-table");
        tableContainer.innerHTML = "";
        tableContainer.appendChild(buildTrendTable(months));
        document.getElementById("trend-table-details").style.display = "block";

        status.textContent =
          months.length + " month(s) loaded (" + months[0].month + " to " + months[months.length - 1].month + ").";
      } catch (error) {
        status.textContent = error.message;
        status.className = "error";
      }
    }

    let productRevenueData = [];

    async function loadProductRevenueGrowth() {
      const companyId = getRealmId();
      const fromYear = document.getElementById("trendsFromYear").value || 2018;

      if (!companyId) {
        return setStatus("Enter a connected company ID (realmId).", true);
      }

      const status = document.getElementById("product-trends-status");
      const select = document.getElementById("productRevenueSelect");
      const locationSelect = document.getElementById("productRevenueLocationSelect");
      const stateSelect = document.getElementById("productRevenueStateSelect");

      try {
        status.textContent =
          "Loading revenue growth per product... this runs one report per product and can take a while.";
        status.className = "";
        select.disabled = true;

        if (locationSelect.options.length <= 1) {
          const locationsData = await request(
            "/api/locations?realmId=" + encodeURIComponent(companyId)
          );
          const departments = locationsData.QueryResponse?.Department || [];
          departments.forEach((department) => {
            const option = document.createElement("option");
            option.value = department.Id;
            option.textContent = department.Name;
            locationSelect.appendChild(option);
          });
        }

        if (stateSelect.options.length <= 1) {
          const statesData = await request(
            "/api/customer-states?realmId=" + encodeURIComponent(companyId)
          );
          (statesData.states || []).forEach((state) => {
            const option = document.createElement("option");
            option.value = state;
            option.textContent = state;
            stateSelect.appendChild(option);
          });
        }

        const selectedLocationId = locationSelect.value;
        const selectedState = stateSelect.value;

        const params = new URLSearchParams({
          realmId: companyId,
          start_date: fromYear + "-01-01",
        });
        if (selectedLocationId) params.set("department", selectedLocationId);
        if (selectedState) params.set("state", selectedState);

        const data = await request("/api/product-revenue-growth?" + params.toString());
        const products = data.products || [];
        const failedProducts = data.failedProducts || [];

        productRevenueData = products;

        select.innerHTML = '<option value="">All products</option>';
        products.forEach((product) => {
          const option = document.createElement("option");
          option.value = product.id;
          option.textContent = product.name;
          select.appendChild(option);
        });
        select.value = "";
        select.disabled = products.length === 0;

        if (!products.length && !failedProducts.length) {
          status.textContent = data.message || "No products found for this company.";
          destroyCharts(productChartInstances);
          document.getElementById("product-trend-charts").innerHTML = "";
          return;
        }

        let statusText = products.length + " product(s) loaded.";
        if (failedProducts.length) {
          statusText +=
            " " + failedProducts.length + " product(s) skipped: " +
            failedProducts.map((p) => p.name + " (" + p.message + ")").join("; ");
        }
        status.textContent = statusText;
        status.className = failedProducts.length ? "error" : "";

        renderProductRevenueChart();
      } catch (error) {
        status.textContent = error.message;
        status.className = "error";
      }
    }

    // Renders the single product-revenue-growth chart for whichever option
    // is currently selected in the dropdown: one product, or (when the
    // "All products" option is selected, value "") every loaded product as
    // its own series on the same chart.
    function renderProductRevenueChart() {
      const container = document.getElementById("product-trend-charts");
      destroyCharts(productChartInstances);
      container.innerHTML = "";

      if (!productRevenueData.length) return;

      const metric = document.querySelector('input[name="productRevenueMetric"]:checked').value;
      const isPercentage = metric === "percentage";
      const valueKey = isPercentage ? "revenueGrowthPct" : "revenue";
      const formatValue = isPercentage ? formatPercentValue : formatCurrencyValue;
      const titlePrefix = isPercentage ? "Revenue growth %" : "Revenue";
      const monthlySubtitle = isPercentage ? "Month over month" : "Actual monthly revenue";

      const locationSelect = document.getElementById("productRevenueLocationSelect");
      const stateSelect = document.getElementById("productRevenueStateSelect");
      const suffixParts = [];
      if (locationSelect.value) {
        suffixParts.push(locationSelect.options[locationSelect.selectedIndex].textContent);
      }
      if (stateSelect.value) {
        suffixParts.push(stateSelect.value);
      }
      const locationSuffix = suffixParts.length ? " (" + suffixParts.join(", ") + ")" : "";

      const selectedId = document.getElementById("productRevenueSelect").value;
      const labels = productRevenueData[0].months.map((m) => m.month);

      if (!selectedId) {
        const series = productRevenueData.map((product, index) => ({
          name: product.name,
          values: product.months.map((m) => m[valueKey]),
          color: seriesPalette[index % seriesPalette.length],
        }));

        renderMultiSeriesBarChart(
          container,
          titlePrefix + " — all products" + locationSuffix,
          monthlySubtitle + ", one series per product",
          labels,
          series,
          productChartInstances,
          formatValue
        );
        return;
      }

      const product = productRevenueData.find((p) => p.id === selectedId);
      if (!product) return;

      const series = [
        {
          name: product.name,
          values: product.months.map((m) => m[valueKey]),
          color: seriesPalette[0],
        },
      ];

      renderMultiSeriesBarChart(
        container,
        titlePrefix + " — " + product.name + locationSuffix,
        monthlySubtitle,
        labels,
        series,
        productChartInstances,
        formatValue
      );
    }

    let customerConcentrationData = null;
    const customerConcentrationChartInstances = [];

    async function loadCustomerConcentration() {
      const companyId = getRealmId();
      const fromYear = document.getElementById("trendsFromYear").value || 2018;

      if (!companyId) {
        return setStatus("Enter a connected company ID (realmId).", true);
      }

      const status = document.getElementById("customer-concentration-status");

      try {
        status.textContent =
          "Loading customer concentration... this runs one report per customer and can take a while.";
        status.className = "";

        const params = new URLSearchParams({
          realmId: companyId,
          start_date: fromYear + "-01-01",
        });

        const data = await request("/api/customer-concentration?" + params.toString());
        customerConcentrationData = data;

        const failedCustomers = data.failedCustomers || [];
        let statusText = (data.customers || []).length + " customer(s) loaded.";
        if (failedCustomers.length) {
          statusText +=
            " " + failedCustomers.length + " customer(s) skipped: " +
            failedCustomers.map((c) => c.name + " (" + c.message + ")").join("; ");
        }
        status.textContent = statusText;
        status.className = failedCustomers.length ? "error" : "";

        renderCustomerConcentrationChart();
      } catch (error) {
        status.textContent = error.message;
        status.className = "error";
      }
    }

    // Computes, for each month, the revenue share held by the top N
    // customers (N from the "Top N customers" textbox) purely client-side
    // from the already-fetched per-customer data — so changing N re-renders
    // instantly without another round trip to QuickBooks.
    function renderCustomerConcentrationChart() {
      const container = document.getElementById("customer-concentration-charts");
      destroyCharts(customerConcentrationChartInstances);
      container.innerHTML = "";

      if (!customerConcentrationData || !customerConcentrationData.customers?.length) return;

      const topN = Math.max(1, parseInt(document.getElementById("topCustomerCount").value, 10) || 1);
      const { customers, totalRevenueByMonth } = customerConcentrationData;
      const labels = totalRevenueByMonth.map((m) => m.month);

      const topCustomersByMonth = labels.map((_, monthIndex) => {
        const ranked = customers
          .map((customer) => ({
            name: customer.name,
            revenue: customer.months[monthIndex]?.revenue || 0,
          }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, topN);

        return ranked;
      });

      const points = labels.map((label, monthIndex) => {
        const totalRevenue = totalRevenueByMonth[monthIndex].revenue;
        const topRevenue = topCustomersByMonth[monthIndex].reduce((sum, c) => sum + c.revenue, 0);

        return {
          label,
          value: totalRevenue > 0 ? (topRevenue / totalRevenue) * 100 : null,
        };
      });

      const series = [
        {
          name: "Top " + topN + " customer(s)' share of revenue",
          values: points.map((p) => p.value),
          color: "#1baf7a",
        },
      ];

      renderMultiSeriesBarChart(
        container,
        "Top " + topN + " customer(s) — % of monthly revenue",
        "Hover a bar to see which customers made up that month's top " + topN,
        labels,
        series,
        customerConcentrationChartInstances,
        formatPercentValue,
        (monthIndex) =>
          topCustomersByMonth[monthIndex].map(
            (c) => c.name + ": " + formatCurrencyValue(c.revenue)
          )
      );
    }
  </script>
</body>
</html>
  `);
});

app.get("/login", (req, res) => {
  oauthState = crypto.randomUUID();

  const authorizationUrl = new URL(
    "https://appcenter.intuit.com/connect/oauth2"
  );

  authorizationUrl.searchParams.set("client_id", QUICKBOOKS_CLIENT_ID);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set(
    "scope",
    "com.intuit.quickbooks.accounting"
  );
  authorizationUrl.searchParams.set(
    "redirect_uri",
    QUICKBOOKS_REDIRECT_URI
  );
  authorizationUrl.searchParams.set("state", oauthState);

  res.redirect(authorizationUrl.toString());
});

app.get("/api/v1/integrations/quickbooks/callback", async (req, res) => {
  const { code, state, realmId, error } = req.query;

  if (error) {
    return res.status(400).send(`QuickBooks authorization failed: ${error}`);
  }

  if (!code || !state || state !== oauthState || !realmId) {
    return res.status(400).send("Invalid QuickBooks OAuth callback.");
  }

  try {
    const basicAuth = Buffer.from(
      `${QUICKBOOKS_CLIENT_ID}:${QUICKBOOKS_CLIENT_SECRET}`
    ).toString("base64");

    const tokenResponse = await fetch(
      "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: QUICKBOOKS_REDIRECT_URI,
        }),
      }
    );

    const tokens = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error("QuickBooks token error:", tokens.error);
      return res.status(500).send("Could not exchange authorization code.");
    }

    connections.set(realmId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    });

    console.log("QuickBooks company connected:", realmId);

    oauthState = undefined;
    res.redirect("/");
  } catch (error) {
    console.error(error.message);
    res.status(500).send("Unexpected server error.");
  }
});

function getConnection(req, res) {
  const requestedRealmId = req.query.realmId;

  if (!requestedRealmId) {
    res.status(400).json({ message: "Enter a QuickBooks company ID (realmId)." });
    return null;
  }

  const connection = connections.get(requestedRealmId);

  if (!connection) {
    res.status(401).json({
      message:
        "This company is not connected. Click Connect QuickBooks Company and authorize this company first.",
    });
    return null;
  }

  return {
    realmId: requestedRealmId,
    accessToken: connection.accessToken,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// QuickBooks sandbox throttles bursts of requests with HTTP 429. Retry a
// handful of times with backoff (honoring Retry-After when QuickBooks sends
// one) before giving up.
async function fetchQuickBooksJson(url, accessToken, attempt = 0) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (response.status === 429 && attempt < 4) {
    const retryAfterHeader = response.headers.get("Retry-After");
    const delayMs = retryAfterHeader
      ? parseFloat(retryAfterHeader) * 1000
      : 500 * 2 ** attempt;

    await sleep(delayMs);
    return fetchQuickBooksJson(url, accessToken, attempt + 1);
  }

  const data = await response.json();

  if (!response.ok) {
    const faultError = data.Fault?.Error?.[0];
    const message =
      faultError?.Message ||
      faultError?.Detail ||
      `QuickBooks request failed (HTTP ${response.status}).`;

    console.error("QuickBooks error for", url.toString(), "-", JSON.stringify(data));

    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

// Runs `fn` over `items` with at most `limit` calls in flight at once —
// QuickBooks sandbox rate-limits bursts, so N parallel report requests
// (one per product) need to be throttled rather than fired all at once.
// Returns results in the same shape as Promise.allSettled.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index], index) };
      } catch (error) {
        results[index] = { status: "rejected", reason: error };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );

  return results;
}

async function fetchQuickBooks(url, accessToken, res) {
  try {
    const data = await fetchQuickBooksJson(url, accessToken);
    res.json(data);
  } catch (error) {
    console.error(error.message);
    res
      .status(error.status || 500)
      .json(error.data || { message: "Could not fetch QuickBooks data." });
  }
}

app.get("/api/company", (req, res) => {
  const connection = getConnection(req, res);
  if (!connection) return;

  const url =
    `${QUICKBOOKS_SANDBOX_URL}/v3/company/` +
    `${connection.realmId}/companyinfo/${connection.realmId}`;

  fetchQuickBooks(url, connection.accessToken, res);
});

// Builds a report URL and applies the optional product/service (item),
// customer, and location filters that QuickBooks reports accept via
// "item"/"customer"/"department" query params. QuickBooks Online's
// "Location" tracking feature is implemented as the Department entity in
// the API — there is no separate "Location" object.
function withReportFilters(url, query) {
  if (query.item) {
    url.searchParams.set("item", query.item);
  }
  if (query.customer) {
    url.searchParams.set("customer", query.customer);
  }
  if (query.department) {
    url.searchParams.set("department", query.department);
  }
  return url;
}

function buildBalanceSheetUrl(realmId, query) {
  const url = new URL(
    `${QUICKBOOKS_SANDBOX_URL}/v3/company/${realmId}/reports/BalanceSheet`
  );

  url.searchParams.set(
    "date",
    query.date || new Date().toISOString().slice(0, 10)
  );

  return withReportFilters(url, query);
}

function buildCashFlowUrl(realmId, query) {
  const url = new URL(
    `${QUICKBOOKS_SANDBOX_URL}/v3/company/${realmId}/reports/CashFlow`
  );

  url.searchParams.set("start_date", query.start_date || "2026-01-01");
  url.searchParams.set(
    "end_date",
    query.end_date || new Date().toISOString().slice(0, 10)
  );

  return withReportFilters(url, query);
}

function buildProfitAndLossUrl(realmId, query) {
  const url = new URL(
    `${QUICKBOOKS_SANDBOX_URL}/v3/company/${realmId}/reports/ProfitAndLoss`
  );

  url.searchParams.set("start_date", query.start_date || "2026-01-01");
  url.searchParams.set(
    "end_date",
    query.end_date || new Date().toISOString().slice(0, 10)
  );

  return withReportFilters(url, query);
}

app.get("/api/balance-sheet", (req, res) => {
  const connection = getConnection(req, res);
  if (!connection) return;

  fetchQuickBooks(
    buildBalanceSheetUrl(connection.realmId, req.query),
    connection.accessToken,
    res
  );
});

app.get("/api/cash-flow", (req, res) => {
  const connection = getConnection(req, res);
  if (!connection) return;

  fetchQuickBooks(
    buildCashFlowUrl(connection.realmId, req.query),
    connection.accessToken,
    res
  );
});

app.get("/api/profit-loss", (req, res) => {
  const connection = getConnection(req, res);
  if (!connection) return;

  fetchQuickBooks(
    buildProfitAndLossUrl(connection.realmId, req.query),
    connection.accessToken,
    res
  );
});

// Products/services (QuickBooks "Items"), used to populate the filter
// dropdown in the UI.
app.get("/api/products", (req, res) => {
  const connection = getConnection(req, res);
  if (!connection) return;

  const url = new URL(
    `${QUICKBOOKS_SANDBOX_URL}/v3/company/${connection.realmId}/query`
  );
  url.searchParams.set("query", "SELECT Id, Name FROM Item MAXRESULTS 1000");

  fetchQuickBooks(url, connection.accessToken, res);
});

// Locations, used to populate the location filter dropdown. QuickBooks
// Online's "Location" tracking feature is the Department entity in the API
// — companies without location tracking enabled will just get an empty
// list back.
app.get("/api/locations", (req, res) => {
  const connection = getConnection(req, res);
  if (!connection) return;

  const url = new URL(
    `${QUICKBOOKS_SANDBOX_URL}/v3/company/${connection.realmId}/query`
  );
  url.searchParams.set("query", "SELECT Id, Name FROM Department MAXRESULTS 1000");

  fetchQuickBooks(url, connection.accessToken, res);
});

// QuickBooks stores a customer's billing address as BillAddr, a
// PhysicalAddress object. Its state field is CountrySubDivisionCode — e.g.
// for a billing address like:
//   Maplewood, NJ  07040
// BillAddr.CountrySubDivisionCode is "NJ". There is no report-level "state"
// filter in the QuickBooks Reports API, so filtering by state means: look
// up which customers are billed to that state, then filter reports by
// those customers' IDs via the existing "customer" report parameter.
async function fetchCustomersWithBillingState(realmId, accessToken) {
  const url = new URL(`${QUICKBOOKS_SANDBOX_URL}/v3/company/${realmId}/query`);
  // QuickBooks' query language only allows scalar fields in a SELECT list —
  // BillAddr is a compound (address) field and isn't selectable by name, so
  // this has to be "SELECT *" rather than listing the columns we want.
  url.searchParams.set("query", "SELECT * FROM Customer MAXRESULTS 1000");

  const data = await fetchQuickBooksJson(url, accessToken);
  return data.QueryResponse?.Customer || [];
}

// States, used to populate the billing-address state filter dropdown.
app.get("/api/customer-states", async (req, res) => {
  const connection = getConnection(req, res);
  if (!connection) return;

  try {
    const customers = await fetchCustomersWithBillingState(
      connection.realmId,
      connection.accessToken
    );

    const states = [
      ...new Set(
        customers
          .map((customer) => customer.BillAddr?.CountrySubDivisionCode)
          .filter(Boolean)
      ),
    ].sort();

    res.json({ states });
  } catch (error) {
    console.error(error.message);
    res
      .status(error.status || 500)
      .json(error.data || { message: "Could not fetch QuickBooks data." });
  }
});

// Fetches Balance Sheet, Cash Flow, and Profit & Loss together so the UI
// can show all three statements from a single "View All Statements" click.
app.get("/api/all-statements", async (req, res) => {
  const connection = getConnection(req, res);
  if (!connection) return;

  try {
    const [balanceSheet, cashFlow, profitLoss] = await Promise.all([
      fetchQuickBooksJson(
        buildBalanceSheetUrl(connection.realmId, req.query),
        connection.accessToken
      ),
      fetchQuickBooksJson(
        buildCashFlowUrl(connection.realmId, req.query),
        connection.accessToken
      ),
      fetchQuickBooksJson(
        buildProfitAndLossUrl(connection.realmId, req.query),
        connection.accessToken
      ),
    ]);

    res.json({ balanceSheet, cashFlow, profitLoss });
  } catch (error) {
    console.error(error.message);
    res
      .status(error.status || 500)
      .json(error.data || { message: "Could not fetch QuickBooks data." });
  }
});

// --- Monthly trend metrics -------------------------------------------

// Last day of the most recently completed calendar month (excludes the
// current, still-in-progress month).
function lastCompletedMonthEndDate() {
  const now = new Date();
  const firstOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastOfPrevMonth = new Date(firstOfThisMonth.getTime() - 24 * 60 * 60 * 1000);
  return lastOfPrevMonth.toISOString().slice(0, 10);
}

function findGroupRow(rows, groupName) {
  return (rows || []).find((row) => row.group === groupName) || null;
}

function summaryValues(row) {
  return (row?.Summary?.ColData || []).map((col) => parseFloat(col.value) || 0);
}

// Walks a section's nested rows to find leaf accounts whose name matches
// `pattern` (used to add Depreciation/Amortization back into EBITDA).
function sumMatchingLeafRows(sectionRow, pattern) {
  const totals = [];

  function walk(row) {
    const children = row.Rows?.Row;

    if (children && children.length) {
      children.forEach(walk);
      return;
    }

    const name = row.ColData?.[0]?.value || "";
    if (!pattern.test(name)) return;

    (row.ColData || []).forEach((col, index) => {
      totals[index] = (totals[index] || 0) + (parseFloat(col.value) || 0);
    });
  }

  (sectionRow?.Rows?.Row || []).forEach(walk);
  return totals;
}

// Turns a ProfitAndLoss report (summarize_column_by=Month) into one row of
// metrics per month: revenue growth %, COGS % of revenue, G&A % of revenue
// (approximated as total operating expenses), and EBITDA margin %
// (Net Operating Income, with Depreciation/Amortization added back where
// those accounts can be identified by name).
function buildMonthlyMetrics(report) {
  const columns = report.Columns?.Column || [];
  const monthColumns = [];

  columns.forEach((column, index) => {
    if (index === 0) return;
    if ((column.ColTitle || "").trim().toLowerCase() === "total") return;
    monthColumns.push({ index, label: column.ColTitle });
  });

  const rows = report.Rows?.Row || [];
  const expensesRow = findGroupRow(rows, "Expenses");

  const revenue = summaryValues(findGroupRow(rows, "Income"));
  const cogs = summaryValues(findGroupRow(rows, "COGS"));
  const expenses = summaryValues(expensesRow);
  const netOperatingIncome = summaryValues(findGroupRow(rows, "NetOperatingIncome"));
  const depreciationAmortization = expensesRow
    ? sumMatchingLeafRows(expensesRow, /depreciation|amortization/i)
    : [];

  let previousRevenue = null;

  return monthColumns.map(({ index, label }) => {
    const rev = revenue[index] || 0;
    const cogsValue = cogs[index] || 0;
    const expensesValue = expenses[index] || 0;
    const ebitda = (netOperatingIncome[index] || 0) + (depreciationAmortization[index] || 0);

    const revenueGrowthPct =
      previousRevenue === null || previousRevenue === 0
        ? null
        : ((rev - previousRevenue) / Math.abs(previousRevenue)) * 100;

    previousRevenue = rev;

    return {
      month: label,
      revenue: rev,
      revenueGrowthPct,
      cogsPct: rev === 0 ? null : (cogsValue / rev) * 100,
      gaPct: rev === 0 ? null : (expensesValue / rev) * 100,
      ebitdaMarginPct: rev === 0 ? null : (ebitda / rev) * 100,
    };
  });
}

app.get("/api/monthly-metrics", async (req, res) => {
  const connection = getConnection(req, res);
  if (!connection) return;

  const url = buildProfitAndLossUrl(connection.realmId, {
    start_date: req.query.start_date || "2018-01-01",
    end_date: req.query.end_date || lastCompletedMonthEndDate(),
    item: req.query.item,
  });
  url.searchParams.set("summarize_column_by", "Month");

  try {
    const report = await fetchQuickBooksJson(url, connection.accessToken);
    res.json({ months: buildMonthlyMetrics(report) });
  } catch (error) {
    console.error(error.message);
    res
      .status(error.status || 500)
      .json(error.data || { message: "Could not fetch QuickBooks data." });
  }
});

// Same monthly revenue-growth metric as /api/monthly-metrics, broken out
// per product/service. Runs one ProfitAndLoss report per item (filtered via
// the report API's "item" parameter), in parallel.
app.get("/api/product-revenue-growth", async (req, res) => {
  const connection = getConnection(req, res);
  if (!connection) return;

  const startDate = req.query.start_date || "2018-01-01";
  const endDate = req.query.end_date || lastCompletedMonthEndDate();

  try {
    // A billing-address state filter resolves to a set of customer IDs,
    // since QuickBooks reports have no native "state" filter.
    let customerFilter;
    if (req.query.state) {
      const customers = await fetchCustomersWithBillingState(
        connection.realmId,
        connection.accessToken
      );
      const matchingIds = customers
        .filter((customer) => customer.BillAddr?.CountrySubDivisionCode === req.query.state)
        .map((customer) => customer.Id);

      if (!matchingIds.length) {
        return res.json({
          products: [],
          failedProducts: [],
          message: "No customers found with a billing address in " + req.query.state + ".",
        });
      }

      customerFilter = matchingIds.join(",");
    }

    const productsUrl = new URL(
      `${QUICKBOOKS_SANDBOX_URL}/v3/company/${connection.realmId}/query`
    );
    productsUrl.searchParams.set(
      "query",
      "SELECT Id, Name, Type FROM Item MAXRESULTS 1000"
    );

    const productsData = await fetchQuickBooksJson(productsUrl, connection.accessToken);
    const allItems = productsData.QueryResponse?.Item || [];

    // Category, Discount, Payment, Subtotal, and Description "items" are
    // grouping/formatting rows, not sellable products — QuickBooks reports
    // reject them as an item filter, so skip them up front.
    const sellableTypes = new Set(["Service", "Inventory", "NonInventory", "Bundle", "Group"]);
    const products = allItems.filter((item) => sellableTypes.has(item.Type));

    const settled = await mapWithConcurrency(products, 3, async (product) => {
      const url = buildProfitAndLossUrl(connection.realmId, {
        start_date: startDate,
        end_date: endDate,
        item: product.Id,
        department: req.query.department,
        customer: customerFilter,
      });
      url.searchParams.set("summarize_column_by", "Month");

      const report = await fetchQuickBooksJson(url, connection.accessToken);
      const months = buildMonthlyMetrics(report).map((m) => ({
        month: m.month,
        revenue: m.revenue,
        revenueGrowthPct: m.revenueGrowthPct,
      }));

      return { id: product.Id, name: product.Name, months };
    });

    const succeeded = [];
    const failed = [];

    settled.forEach((result, index) => {
      if (result.status === "fulfilled") {
        succeeded.push(result.value);
      } else {
        failed.push({
          id: products[index].Id,
          name: products[index].Name,
          message: result.reason?.message || "Request failed.",
        });
      }
    });

    res.json({ products: succeeded, failedProducts: failed });
  } catch (error) {
    console.error(error.message);
    res
      .status(error.status || 500)
      .json(error.data || { message: "Could not fetch QuickBooks data." });
  }
});

// Per-customer, per-month revenue, plus company-wide monthly revenue for
// comparison. The frontend computes "top N customers' share of revenue"
// itself from this raw data, so changing N doesn't require a re-fetch.
app.get("/api/customer-concentration", async (req, res) => {
  const connection = getConnection(req, res);
  if (!connection) return;

  const startDate = req.query.start_date || "2018-01-01";
  const endDate = req.query.end_date || lastCompletedMonthEndDate();

  try {
    const totalUrl = buildProfitAndLossUrl(connection.realmId, {
      start_date: startDate,
      end_date: endDate,
    });
    totalUrl.searchParams.set("summarize_column_by", "Month");

    const totalReport = await fetchQuickBooksJson(totalUrl, connection.accessToken);
    const totalRevenueByMonth = buildMonthlyMetrics(totalReport).map((m) => ({
      month: m.month,
      revenue: m.revenue,
    }));

    const customersUrl = new URL(
      `${QUICKBOOKS_SANDBOX_URL}/v3/company/${connection.realmId}/query`
    );
    customersUrl.searchParams.set(
      "query",
      "SELECT Id, DisplayName FROM Customer MAXRESULTS 1000"
    );

    const customersData = await fetchQuickBooksJson(customersUrl, connection.accessToken);
    const customers = customersData.QueryResponse?.Customer || [];

    const settled = await mapWithConcurrency(customers, 3, async (customer) => {
      const url = buildProfitAndLossUrl(connection.realmId, {
        start_date: startDate,
        end_date: endDate,
        customer: customer.Id,
      });
      url.searchParams.set("summarize_column_by", "Month");

      const report = await fetchQuickBooksJson(url, connection.accessToken);
      const months = buildMonthlyMetrics(report).map((m) => ({
        month: m.month,
        revenue: m.revenue,
      }));

      return { id: customer.Id, name: customer.DisplayName, months };
    });

    const succeeded = [];
    const failed = [];

    settled.forEach((result, index) => {
      if (result.status === "fulfilled") {
        succeeded.push(result.value);
      } else {
        failed.push({
          id: customers[index].Id,
          name: customers[index].DisplayName,
          message: result.reason?.message || "Request failed.",
        });
      }
    });

    res.json({ customers: succeeded, totalRevenueByMonth, failedCustomers: failed });
  } catch (error) {
    console.error(error.message);
    res
      .status(error.status || 500)
      .json(error.data || { message: "Could not fetch QuickBooks data." });
  }
});

app.listen(PORT, () => {
  console.log(`Open http://localhost:${PORT}`);
});