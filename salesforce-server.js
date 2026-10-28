require("dotenv").config();

const crypto = require("crypto");
const express = require("express");

const app = express();

const {
  PORT = 3105,
  SALESFORCE_CLIENT_ID,
  SALESFORCE_CLIENT_SECRET,
  SALESFORCE_REDIRECT_URI,
  SALESFORCE_LOGIN_URL = "https://login.salesforce.com",
} = process.env;

if (
  !SALESFORCE_CLIENT_ID ||
  !SALESFORCE_CLIENT_SECRET ||
  !SALESFORCE_REDIRECT_URI
) {
  throw new Error("Missing Salesforce settings in .env");
}

// Learning-only storage: these reset when Node.js stops.
let oauthState;
let codeVerifier;
let accessToken;
let refreshToken;
let instanceUrl;

function base64Url(buffer) {
  return buffer.toString("base64url");
}

const DATA_CARDS = [
  {
    key: "accounts",
    href: "/api/accounts",
    icon: "🏢",
    title: "Accounts",
    subtitle: "Companies",
    description: "Industry, phone, and website for your top accounts.",
  },
  {
    key: "leads",
    href: "/api/leads",
    icon: "🎯",
    title: "Leads",
    subtitle: "Prospects",
    description: "Contact details and status for open leads.",
  },
  {
    key: "contacts",
    href: "/api/contacts",
    icon: "👤",
    title: "Contacts",
    subtitle: "People",
    description: "People linked to accounts, with contact info.",
  },
  {
    key: "campaigns",
    href: "/api/campaigns",
    icon: "📣",
    title: "Campaigns",
    subtitle: "Marketing",
    description: "Campaign status, type, and active date ranges.",
  },
  {
    key: "opportunities",
    href: "/api/opportunities",
    icon: "💰",
    title: "Opportunities",
    subtitle: "Deals",
    description: "Deal amount, stage, and expected close date.",
  },
];

function renderHomePage() {
  const isConnected = Boolean(accessToken && instanceUrl);

  const statusBadge = isConnected
    ? `<span class="badge badge-on"><span class="dot"></span>Connected</span>`
    : `<span class="badge badge-off"><span class="dot"></span>Not connected</span>`;

  const statusDetail = isConnected
    ? `<p class="status-detail">Instance: <code>${instanceUrl}</code></p>`
    : `<p class="status-detail">Connect your Salesforce org to unlock live CRM data below.</p>`;

  const connectButton = isConnected
    ? `<a class="btn btn-secondary" href="/login">Reconnect</a>`
    : `<a class="btn btn-primary" href="/login">Connect Salesforce</a>`;

  const cards = DATA_CARDS.map(
    (card) => `
      <button
        type="button"
        class="card ${isConnected ? "" : "card-disabled"}"
        data-key="${card.key}"
        data-endpoint="${card.href}"
        data-title="${card.title}"
        ${isConnected ? "" : "disabled"}
      >
        <div class="card-icon">${card.icon}</div>
        <div class="card-body">
          <h3>${card.title}</h3>
          <p class="card-subtitle">${card.subtitle}</p>
          <p class="card-description">${card.description}</p>
        </div>
        <div class="card-arrow">→</div>
      </button>`
  ).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Salesforce OAuth Console</title>
<style>
  :root {
    --sf-blue: #0176d3;
    --sf-blue-dark: #014486;
    --sf-ink: #16325c;
    --sf-muted: #706e6b;
    --sf-bg: #f3f5f7;
    --sf-surface: #ffffff;
    --sf-border: #e5e5e5;
    --sf-green: #2e844a;
    --sf-red: #ba0517;
    --shadow: 0 2px 6px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.08);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      Helvetica, Arial, sans-serif;
    background: var(--sf-bg);
    color: var(--sf-ink);
  }
  .topbar {
    background: linear-gradient(135deg, var(--sf-blue) 0%, var(--sf-blue-dark) 100%);
    color: #fff;
    padding: 20px 32px;
    display: flex;
    align-items: center;
    gap: 12px;
    box-shadow: var(--shadow);
  }
  .topbar .logo {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.15);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
  }
  .topbar h1 {
    font-size: 18px;
    margin: 0;
    font-weight: 600;
  }
  .topbar p {
    margin: 2px 0 0;
    font-size: 13px;
    opacity: 0.85;
  }
  .container {
    max-width: 960px;
    margin: 0 auto;
    padding: 32px 20px 64px;
  }
  .status-card {
    background: var(--sf-surface);
    border: 1px solid var(--sf-border);
    border-radius: 12px;
    padding: 24px;
    box-shadow: var(--shadow);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .status-left h2 {
    font-size: 16px;
    margin: 0 0 6px;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .badge-on { background: #e3f6e9; color: var(--sf-green); }
  .badge-off { background: #f4ecec; color: var(--sf-red); }
  .badge .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
  }
  .status-detail {
    margin: 10px 0 0;
    font-size: 13px;
    color: var(--sf-muted);
  }
  .status-detail code {
    background: #f4f6f9;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 12px;
  }
  .btn {
    display: inline-block;
    padding: 10px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    text-decoration: none;
    transition: background 0.15s ease, transform 0.05s ease;
    white-space: nowrap;
  }
  .btn:active { transform: translateY(1px); }
  .btn-primary {
    background: var(--sf-blue);
    color: #fff;
  }
  .btn-primary:hover { background: var(--sf-blue-dark); }
  .btn-secondary {
    background: #fff;
    color: var(--sf-blue);
    border: 1px solid var(--sf-blue);
  }
  .btn-secondary:hover { background: #eef6fd; }
  .section-title {
    margin: 40px 0 16px;
    font-size: 16px;
    font-weight: 700;
    color: var(--sf-ink);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .section-title .count {
    font-weight: 500;
    font-size: 12px;
    color: var(--sf-muted);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 16px;
  }
  .card {
    background: var(--sf-surface);
    border: 1px solid var(--sf-border);
    border-radius: 12px;
    padding: 18px;
    display: flex;
    align-items: flex-start;
    gap: 14px;
    text-decoration: none;
    color: inherit;
    box-shadow: var(--shadow);
    transition: transform 0.12s ease, box-shadow 0.12s ease;
    font: inherit;
    text-align: left;
    width: 100%;
    cursor: pointer;
  }
  .card:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(1, 68, 134, 0.12);
  }
  .card-active {
    border-color: var(--sf-blue);
    box-shadow: 0 0 0 2px rgba(1, 118, 211, 0.25), 0 6px 16px rgba(1, 68, 134, 0.12);
  }
  .card-disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .card-disabled:hover { transform: none; box-shadow: var(--shadow); }
  .card:disabled { pointer-events: none; }
  .card-icon {
    font-size: 24px;
    width: 44px;
    height: 44px;
    border-radius: 10px;
    background: #eef6fd;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .card-body h3 {
    margin: 0 0 2px;
    font-size: 15px;
  }
  .card-subtitle {
    margin: 0 0 6px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--sf-blue);
  }
  .card-description {
    margin: 0;
    font-size: 13px;
    color: var(--sf-muted);
    line-height: 1.4;
  }
  .card-arrow {
    margin-left: auto;
    color: var(--sf-muted);
    font-size: 16px;
    align-self: center;
  }
  .footnote {
    margin-top: 48px;
    text-align: center;
    font-size: 12px;
    color: var(--sf-muted);
  }
  .results {
    margin-top: 40px;
    background: var(--sf-surface);
    border: 1px solid var(--sf-border);
    border-radius: 12px;
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  .results[hidden] { display: none; }
  .results-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 18px 22px;
    border-bottom: 1px solid var(--sf-border);
    flex-wrap: wrap;
  }
  .results-header h2 {
    margin: 0;
    font-size: 16px;
  }
  .results-meta {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--sf-muted);
  }
  .results-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .btn-sm {
    padding: 6px 14px;
    font-size: 12px;
  }
  .results-body {
    padding: 22px;
  }
  .muted { color: var(--sf-muted); }
  .table-scroll {
    overflow-x: auto;
    border: 1px solid var(--sf-border);
    border-radius: 8px;
  }
  .data-table {
    border-collapse: collapse;
    width: 100%;
    font-size: 13px;
    white-space: nowrap;
  }
  .data-table th {
    background: #f4f6f9;
    text-align: left;
    padding: 10px 14px;
    font-weight: 600;
    color: var(--sf-ink);
    border-bottom: 1px solid var(--sf-border);
    position: sticky;
    top: 0;
  }
  .data-table td {
    padding: 10px 14px;
    border-bottom: 1px solid var(--sf-border);
    color: var(--sf-ink);
  }
  .data-table tr:last-child td { border-bottom: none; }
  .data-table tbody tr:hover { background: #f9fbfd; }
  .error-box {
    background: #fbeceb;
    color: var(--sf-red);
    border: 1px solid #f3c9c7;
    border-radius: 8px;
    padding: 14px 16px;
    font-size: 13px;
  }
  .spinner {
    width: 24px;
    height: 24px;
    border: 3px solid #dbe7f3;
    border-top-color: var(--sf-blue);
    border-radius: 50%;
    margin: 8px auto;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .stat-banner {
    display: flex;
    align-items: center;
    gap: 20px;
    background: linear-gradient(135deg, #eef6fd 0%, #f4f9ff 100%);
    border: 1px solid #cfe4f7;
    border-radius: 10px;
    padding: 16px 20px;
    margin-bottom: 16px;
  }
  .stat-main {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 70px;
  }
  .stat-value {
    font-size: 28px;
    font-weight: 700;
    color: var(--sf-blue-dark);
    line-height: 1;
  }
  .stat-label {
    margin-top: 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--sf-blue);
    white-space: nowrap;
  }
  .stat-sub {
    font-size: 13px;
    color: var(--sf-ink);
  }
</style>
</head>
<body>
  <div class="topbar">
    <div class="logo">☁️</div>
    <div>
      <h1>Salesforce OAuth Console</h1>
      <p>OAuth 2.0 + PKCE learning app</p>
    </div>
  </div>

  <div class="container">
    <div class="status-card">
      <div class="status-left">
        <h2>Connection status</h2>
        ${statusBadge}
        ${statusDetail}
      </div>
      ${connectButton}
    </div>

    <div class="section-title">
      CRM Data Explorer <span class="count">${DATA_CARDS.length} objects</span>
    </div>
    <div class="grid">
      ${cards}
    </div>

    <section id="results" class="results" hidden>
      <div class="results-header">
        <div>
          <h2 id="results-title">—</h2>
          <p id="results-meta" class="results-meta"></p>
        </div>
        <div class="results-actions">
          <a id="results-raw-link" class="btn btn-secondary btn-sm" href="#" target="_blank" rel="noopener">View raw JSON ↗</a>
          <button id="results-close" class="btn btn-secondary btn-sm" type="button">Close ✕</button>
        </div>
      </div>
      <div id="results-body" class="results-body"></div>
    </section>

    <p class="footnote">Tokens are held in memory only and reset when the server restarts.</p>
  </div>

  <script>
  (function () {
    var cardButtons = document.querySelectorAll(".card[data-key]");
    var results = document.getElementById("results");
    var resultsTitle = document.getElementById("results-title");
    var resultsMeta = document.getElementById("results-meta");
    var resultsBody = document.getElementById("results-body");
    var resultsRawLink = document.getElementById("results-raw-link");
    var resultsClose = document.getElementById("results-close");

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    }

    function flattenRecord(record) {
      var flat = {};
      Object.keys(record).forEach(function (key) {
        if (key === "attributes") return;
        var value = record[key];
        if (value && typeof value === "object" && !Array.isArray(value)) {
          Object.keys(value).forEach(function (nestedKey) {
            if (nestedKey === "attributes") return;
            flat[key + "." + nestedKey] = value[nestedKey];
          });
        } else {
          flat[key] = value;
        }
      });
      return flat;
    }

    function renderTable(records, extraHtml) {
      if (!records || records.length === 0) {
        resultsBody.innerHTML = (extraHtml || "") + '<p class="muted">No records found.</p>';
        return;
      }

      var flatRecords = records.map(flattenRecord);
      var columns = [];
      var seen = {};
      flatRecords.forEach(function (rec) {
        Object.keys(rec).forEach(function (key) {
          if (!seen[key]) {
            seen[key] = true;
            columns.push(key);
          }
        });
      });

      var thead = "<tr>" + columns.map(function (c) {
        return "<th>" + escapeHtml(c) + "</th>";
      }).join("") + "</tr>";

      var rows = flatRecords.map(function (rec) {
        return "<tr>" + columns.map(function (c) {
          var value = rec[c];
          return "<td>" + (value === null || value === undefined || value === ""
            ? '<span class="muted">—</span>'
            : escapeHtml(value)) + "</td>";
        }).join("") + "</tr>";
      }).join("");

      resultsBody.innerHTML = (extraHtml || "") +
        '<div class="table-scroll"><table class="data-table"><thead>' +
        thead + "</thead><tbody>" + rows + "</tbody></table></div>";
    }

    function computeCompetitiveWinRate(records) {
      var groups = {};
      var overallWon = 0;
      var overallClosed = 0;

      records.forEach(function (rec) {
        var raw = rec.MainCompetitors__c;
        if (!raw) return;

        var competitors = String(raw)
          .split(";")
          .map(function (c) { return c.trim(); })
          .filter(Boolean);
        if (competitors.length === 0 || !rec.IsClosed) return;

        overallClosed++;
        if (rec.IsWon) overallWon++;

        competitors.forEach(function (c) {
          if (!groups[c]) groups[c] = { won: 0, lost: 0 };
          if (rec.IsWon) groups[c].won++;
          else groups[c].lost++;
        });
      });

      if (overallClosed === 0) return null;

      var breakdown = Object.keys(groups)
        .map(function (name) {
          var g = groups[name];
          var closed = g.won + g.lost;
          return {
            name: name,
            won: g.won,
            lost: g.lost,
            closed: closed,
            rate: closed === 0 ? 0 : (g.won / closed) * 100,
          };
        })
        .sort(function (a, b) { return b.closed - a.closed; });

      return {
        overallWon: overallWon,
        overallClosed: overallClosed,
        overallRate: (overallWon / overallClosed) * 100,
        breakdown: breakdown,
      };
    }

    function renderCompetitiveWinRate(records) {
      var stats = computeCompetitiveWinRate(records);
      if (!stats) return "";

      var rows = stats.breakdown.map(function (b) {
        return "<tr><td>" + escapeHtml(b.name) + "</td><td>" + b.won +
          "</td><td>" + b.lost + "</td><td>" + b.closed + "</td><td>" +
          b.rate.toFixed(0) + "%</td></tr>";
      }).join("");

      return '' +
        '<div class="stat-banner">' +
          '<div class="stat-main">' +
            '<div class="stat-value">' + stats.overallRate.toFixed(0) + '%</div>' +
            '<div class="stat-label">Competitive Win Rate</div>' +
          '</div>' +
          '<div class="stat-sub">' + stats.overallWon + ' won of ' + stats.overallClosed +
            ' closed deals where a competitor was named</div>' +
        '</div>' +
        '<div class="table-scroll" style="margin-bottom:18px;">' +
          '<table class="data-table">' +
            '<thead><tr><th>Competitor</th><th>Won</th><th>Lost</th><th>Closed</th><th>Win Rate</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>';
    }

    function getQuarterInfo(dateInput) {
      var d = new Date(dateInput);
      if (isNaN(d.getTime())) return null;
      var quarter = Math.floor(d.getMonth() / 3) + 1;
      return { year: d.getFullYear(), quarter: quarter, key: d.getFullYear() + " Q" + quarter };
    }

    // New-Logo Revenue Growth Rate (VC-03): closed-won "New Business" deals,
    // compared quarter over quarter.
    function computeNewLogoGrowth(records) {
      var byQuarter = {};

      records.forEach(function (rec) {
        if (!rec.IsWon || rec.Type !== "New Business" || !rec.CloseDate) return;
        var q = getQuarterInfo(rec.CloseDate);
        if (!q) return;
        if (!byQuarter[q.key]) {
          byQuarter[q.key] = { key: q.key, year: q.year, quarter: q.quarter, revenue: 0, deals: 0 };
        }
        byQuarter[q.key].revenue += Number(rec.Amount) || 0;
        byQuarter[q.key].deals += 1;
      });

      var quarters = Object.keys(byQuarter)
        .map(function (k) { return byQuarter[k]; })
        .sort(function (a, b) { return a.year - b.year || a.quarter - b.quarter; });

      if (quarters.length < 2) return { quarters: quarters, growth: null };

      var current = quarters[quarters.length - 1];
      var prior = quarters[quarters.length - 2];
      var growth = prior.revenue > 0 ? ((current.revenue - prior.revenue) / prior.revenue) * 100 : null;

      return { quarters: quarters, current: current, prior: prior, growth: growth };
    }

    function renderNewLogoGrowth(records) {
      var stats = computeNewLogoGrowth(records);
      if (!stats.quarters.length) return "";

      if (stats.quarters.length < 2 || stats.growth === null) {
        return '<div class="stat-banner">' +
          '<div class="stat-main"><div class="stat-value">—</div>' +
          '<div class="stat-label">New-Logo Growth</div></div>' +
          '<div class="stat-sub">Not computable: need closed-won New Business deals in at least two quarters.</div>' +
          '</div>';
      }

      var rows = stats.quarters.map(function (q) {
        return "<tr><td>" + escapeHtml(q.key) + "</td><td>" + q.deals + "</td><td>" +
          escapeHtml(formatCurrency(q.revenue)) + "</td></tr>";
      }).join("");

      return '' +
        '<div class="stat-banner">' +
          '<div class="stat-main">' +
            '<div class="stat-value">' + (stats.growth >= 0 ? "+" : "") + stats.growth.toFixed(1) + '%</div>' +
            '<div class="stat-label">New-Logo Growth</div>' +
          '</div>' +
          '<div class="stat-sub">' + escapeHtml(formatCurrency(stats.current.revenue)) + ' in new-logo revenue in ' +
            escapeHtml(stats.current.key) + ' vs ' + escapeHtml(formatCurrency(stats.prior.revenue)) +
            ' in ' + escapeHtml(stats.prior.key) + '</div>' +
        '</div>' +
        '<div class="table-scroll" style="margin-bottom:18px;">' +
          '<table class="data-table">' +
            '<thead><tr><th>Quarter</th><th>New-Logo Deals</th><th>New-Logo Revenue</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>';
    }

    // Customer Concentration (CM-02): share of trailing-12-month won revenue
    // held by the top 10 / top 5 / single largest account.
    function computeCustomerConcentration(records) {
      var now = new Date();
      var cutoff = new Date(now);
      cutoff.setFullYear(cutoff.getFullYear() - 1);

      var byAccount = {};
      var total = 0;

      records.forEach(function (rec) {
        if (!rec.IsWon || !rec.CloseDate) return;
        var closeDate = new Date(rec.CloseDate);
        if (closeDate < cutoff || closeDate > now) return;

        var accountName = rec.Account && rec.Account.Name ? rec.Account.Name : "Unknown Account";
        var amount = Number(rec.Amount) || 0;
        byAccount[accountName] = (byAccount[accountName] || 0) + amount;
        total += amount;
      });

      if (total <= 0) return null;

      var sorted = Object.keys(byAccount)
        .map(function (name) { return { name: name, revenue: byAccount[name] }; })
        .sort(function (a, b) { return b.revenue - a.revenue; });

      function sumTop(n) {
        return sorted.slice(0, n).reduce(function (s, c) { return s + c.revenue; }, 0);
      }

      return {
        total: total,
        top1Pct: (sumTop(1) / total) * 100,
        top5Pct: (sumTop(5) / total) * 100,
        top10Pct: (sumTop(10) / total) * 100,
        top10: sorted.slice(0, 10),
      };
    }

    function renderCustomerConcentration(records) {
      var stats = computeCustomerConcentration(records);
      if (!stats) {
        return '<div class="stat-banner">' +
          '<div class="stat-main"><div class="stat-value">—</div>' +
          '<div class="stat-label">Customer Concentration</div></div>' +
          '<div class="stat-sub">Not computable: no closed-won revenue in the trailing 12 months.</div>' +
          '</div>';
      }

      var rows = stats.top10.map(function (c, i) {
        return "<tr><td>" + (i + 1) + "</td><td>" + escapeHtml(c.name) + "</td><td>" +
          escapeHtml(formatCurrency(c.revenue)) + "</td><td>" +
          ((c.revenue / stats.total) * 100).toFixed(1) + "%</td></tr>";
      }).join("");

      return '' +
        '<div class="stat-banner">' +
          '<div class="stat-main">' +
            '<div class="stat-value">' + stats.top10Pct.toFixed(0) + '%</div>' +
            '<div class="stat-label">Top-10 Concentration</div>' +
          '</div>' +
          '<div class="stat-sub">Top 5: ' + stats.top5Pct.toFixed(1) + '% &middot; Largest customer: ' +
            stats.top1Pct.toFixed(1) + '% &middot; of ' + escapeHtml(formatCurrency(stats.total)) +
            ' won in the trailing 12 months</div>' +
        '</div>' +
        '<div class="table-scroll" style="margin-bottom:18px;">' +
          '<table class="data-table">' +
            '<thead><tr><th>#</th><th>Account</th><th>Revenue (TTM)</th><th>Share</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>';
    }

    // Pipeline Coverage Ratio (CM-04): qualified open pipeline closing next
    // quarter, divided by a target. Salesforce has no operating-plan
    // connector in this demo, so the target is entered by hand rather than
    // guessed at (an honest "not computable" beats a fabricated number).
    function getNextQuarterRange(now) {
      var year = now.getFullYear();
      var currentQuarter = Math.floor(now.getMonth() / 3) + 1;
      var nextQuarter = currentQuarter + 1;
      var nextYear = year;
      if (nextQuarter > 4) {
        nextQuarter = 1;
        nextYear = year + 1;
      }
      var startMonth = (nextQuarter - 1) * 3;
      return {
        label: nextYear + " Q" + nextQuarter,
        start: new Date(nextYear, startMonth, 1),
        end: new Date(nextYear, startMonth + 3, 1),
      };
    }

    function computePipelineCoverage(records, target) {
      var range = getNextQuarterRange(new Date());
      var pipeline = 0;
      var deals = 0;

      records.forEach(function (rec) {
        if (rec.IsClosed || !rec.CloseDate) return;
        var closeDate = new Date(rec.CloseDate);
        if (closeDate >= range.start && closeDate < range.end) {
          pipeline += Number(rec.Amount) || 0;
          deals += 1;
        }
      });

      var numericTarget = Number(target);
      var hasTarget = target !== null && target !== undefined && target !== "" && numericTarget > 0;

      return {
        range: range,
        pipeline: pipeline,
        deals: deals,
        target: hasTarget ? numericTarget : null,
        coverage: hasTarget ? pipeline / numericTarget : null,
      };
    }

    function pipelineCoverageSubHtml(stats) {
      return escapeHtml(formatCurrency(stats.pipeline)) + " of open pipeline (" + stats.deals +
        " deal" + (stats.deals === 1 ? "" : "s") + ") closing in " + stats.range.label +
        (stats.target === null
          ? " — enter a next-quarter target to compute coverage"
          : " vs a " + escapeHtml(formatCurrency(stats.target)) + " target");
    }

    function renderPipelineCoverage(records, target) {
      var stats = computePipelineCoverage(records, target);
      var valueHtml = stats.coverage === null ? "—" : stats.coverage.toFixed(2) + "x";

      return '' +
        '<div class="stat-banner" id="pipeline-coverage-banner">' +
          '<div class="stat-main">' +
            '<div class="stat-value">' + valueHtml + '</div>' +
            '<div class="stat-label">Pipeline Coverage</div>' +
          '</div>' +
          '<div class="stat-sub">' + pipelineCoverageSubHtml(stats) + '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;">' +
          '<label for="pipeline-target-input" style="font-size:13px;color:var(--sf-muted);">Next-quarter target ($)</label>' +
          '<input type="number" min="0" step="1000" id="pipeline-target-input" value="' +
            (stats.target === null ? "" : stats.target) +
            '" placeholder="e.g. 500000" style="padding:6px 10px;border:1px solid var(--sf-border);border-radius:6px;font-size:13px;width:160px;" />' +
        '</div>';
    }

    function formatCurrency(n) {
      if (n === null || n === undefined || isNaN(n)) return null;
      var num = Number(n);
      var sign = num < 0 ? "-" : "";
      return sign + "$" + Math.abs(num).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }

    // CAC = campaign spend (ActualCost) divided by customers acquired
    // (won opportunities attributed to the campaign).
    // ROI = (won revenue - spend) / spend, as a percentage.
    function enrichCampaignRecord(rec) {
      var cost = Number(rec.ActualCost) || 0;
      var wonRevenue = Number(rec.AmountWonOpportunities) || 0;
      var customersAcquired = Number(rec.NumberOfWonOpportunities) || 0;

      var cac = customersAcquired > 0 ? cost / customersAcquired : null;
      var roi = cost > 0 ? ((wonRevenue - cost) / cost) * 100 : null;

      var enriched = Object.assign({}, rec);
      enriched["Customers Acquired"] = customersAcquired;
      enriched["CAC"] = cac === null ? "N/A" : formatCurrency(cac);
      enriched["ROI (%)"] = roi === null ? "N/A" : (roi >= 0 ? "+" : "") + roi.toFixed(1) + "%";
      return enriched;
    }

    // Channel = the campaign's Type field (Webinar, Email, Trade Show, etc.).
    function computeROIByChannel(records) {
      var groups = {};

      records.forEach(function (rec) {
        var channel = rec.Type || "Unspecified";
        var cost = Number(rec.ActualCost) || 0;
        var revenue = Number(rec.AmountWonOpportunities) || 0;
        var customers = Number(rec.NumberOfWonOpportunities) || 0;

        if (!groups[channel]) {
          groups[channel] = { cost: 0, revenue: 0, customers: 0, campaigns: 0 };
        }
        groups[channel].cost += cost;
        groups[channel].revenue += revenue;
        groups[channel].customers += customers;
        groups[channel].campaigns += 1;
      });

      return Object.keys(groups)
        .map(function (channel) {
          var g = groups[channel];
          return {
            channel: channel,
            campaigns: g.campaigns,
            cost: g.cost,
            revenue: g.revenue,
            customers: g.customers,
            roi: g.cost > 0 ? ((g.revenue - g.cost) / g.cost) * 100 : null,
            cac: g.customers > 0 ? g.cost / g.customers : null,
          };
        })
        .sort(function (a, b) { return b.cost - a.cost; });
    }

    function renderMarketingROIByChannel(records) {
      var channels = computeROIByChannel(records);
      if (channels.length === 0) return "";

      var totalCost = channels.reduce(function (s, c) { return s + c.cost; }, 0);
      var totalRevenue = channels.reduce(function (s, c) { return s + c.revenue; }, 0);
      var overallRoi = totalCost > 0 ? ((totalRevenue - totalCost) / totalCost) * 100 : null;

      var rows = channels.map(function (c) {
        return "<tr><td>" + escapeHtml(c.channel) + "</td><td>" + c.campaigns +
          "</td><td>" + escapeHtml(formatCurrency(c.cost)) +
          "</td><td>" + escapeHtml(formatCurrency(c.revenue)) +
          "</td><td>" + c.customers +
          "</td><td>" + (c.cac === null
            ? '<span class="muted">N/A</span>'
            : escapeHtml(formatCurrency(c.cac))) +
          "</td><td>" + (c.roi === null
            ? '<span class="muted">N/A</span>'
            : (c.roi >= 0 ? "+" : "") + c.roi.toFixed(1) + "%") +
          "</td></tr>";
      }).join("");

      return '' +
        '<div class="stat-banner">' +
          '<div class="stat-main">' +
            '<div class="stat-value">' +
              (overallRoi === null ? "N/A" : (overallRoi >= 0 ? "+" : "") + overallRoi.toFixed(0) + "%") +
            '</div>' +
            '<div class="stat-label">Marketing ROI</div>' +
          '</div>' +
          '<div class="stat-sub">' + escapeHtml(formatCurrency(totalRevenue)) + ' won revenue vs ' +
            escapeHtml(formatCurrency(totalCost)) + ' spent across ' + channels.length +
            ' channel' + (channels.length === 1 ? '' : 's') + '</div>' +
        '</div>' +
        '<div class="table-scroll" style="margin-bottom:18px;">' +
          '<table class="data-table">' +
            '<thead><tr><th>Channel</th><th>Campaigns</th><th>Spend</th><th>Won Revenue</th>' +
              '<th>Customers</th><th>CAC</th><th>ROI</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>';
    }

    function extractErrorMessage(data, fallback) {
      if (Array.isArray(data) && data[0] && data[0].message) return data[0].message;
      if (data && data.message) return data.message;
      return fallback;
    }

    var currentOpportunityRecords = [];
    var pipelineTarget = "";

    function loadData(key, endpoint, title) {
      results.hidden = false;
      resultsTitle.textContent = title;
      resultsMeta.textContent = "Loading…";
      resultsRawLink.href = endpoint;
      resultsBody.innerHTML = '<div class="spinner"></div>';
      results.scrollIntoView({ behavior: "smooth", block: "start" });

      cardButtons.forEach(function (btn) {
        btn.classList.toggle("card-active", btn.dataset.key === key);
      });

      fetch(endpoint)
        .then(function (response) {
          return response.json().then(function (data) {
            return { ok: response.ok, data: data };
          });
        })
        .then(function (result) {
          if (!result.ok) {
            resultsMeta.textContent = "";
            resultsBody.innerHTML = '<div class="error-box">' +
              escapeHtml(extractErrorMessage(result.data, "Could not load data.")) +
              "</div>";
            return;
          }
          var records = result.data.records || [];
          resultsMeta.textContent = records.length + " record" + (records.length === 1 ? "" : "s");

          var extraHtml = "";
          if (key === "opportunities") {
            currentOpportunityRecords = records;
            extraHtml = renderCompetitiveWinRate(records) +
              renderNewLogoGrowth(records) +
              renderCustomerConcentration(records) +
              renderPipelineCoverage(records, pipelineTarget);
          } else if (key === "campaigns") {
            extraHtml = renderMarketingROIByChannel(records);
            records = records.map(enrichCampaignRecord);
          }
          renderTable(records, extraHtml);
        })
        .catch(function (err) {
          resultsMeta.textContent = "";
          resultsBody.innerHTML = '<div class="error-box">Could not load data. ' +
            escapeHtml(err.message) + "</div>";
        });
    }

    cardButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        loadData(btn.dataset.key, btn.dataset.endpoint, btn.dataset.title);
      });
    });

    resultsBody.addEventListener("input", function (e) {
      if (!e.target || e.target.id !== "pipeline-target-input") return;

      pipelineTarget = e.target.value;
      var banner = document.getElementById("pipeline-coverage-banner");
      if (!banner) return;

      var stats = computePipelineCoverage(currentOpportunityRecords, pipelineTarget);
      var valueEl = banner.querySelector(".stat-value");
      var subEl = banner.querySelector(".stat-sub");
      if (valueEl) valueEl.textContent = stats.coverage === null ? "—" : stats.coverage.toFixed(2) + "x";
      if (subEl) subEl.innerHTML = pipelineCoverageSubHtml(stats);
    });

    resultsClose.addEventListener("click", function () {
      results.hidden = true;
      cardButtons.forEach(function (btn) {
        btn.classList.remove("card-active");
      });
    });
  })();
  </script>
</body>
</html>`;
}

app.get("/", (req, res) => {
  res.send(renderHomePage());
});

app.get("/login", (req, res) => {
  oauthState = crypto.randomUUID();

  // PKCE creates a secret verifier and a safe hash sent to Salesforce.
  codeVerifier = base64Url(crypto.randomBytes(32));

  const codeChallenge = base64Url(
    crypto.createHash("sha256").update(codeVerifier).digest()
  );

  const authorizationUrl = new URL(
    `${SALESFORCE_LOGIN_URL}/services/oauth2/authorize`
  );

  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", SALESFORCE_CLIENT_ID);
  authorizationUrl.searchParams.set(
    "redirect_uri",
    SALESFORCE_REDIRECT_URI
  );
  authorizationUrl.searchParams.set("state", oauthState);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  res.redirect(authorizationUrl.toString());
});

app.get("/api/v1/integrations/salesforce/callback", async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    return res
      .status(400)
      .send(`Salesforce authorization failed: ${error_description || error}`);
  }

  if (!code || !state || state !== oauthState) {
    return res.status(400).send("Invalid OAuth callback.");
  }

  try {
    const tokenResponse = await fetch(
      `${SALESFORCE_LOGIN_URL}/services/oauth2/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: SALESFORCE_CLIENT_ID,
          client_secret: SALESFORCE_CLIENT_SECRET,
          redirect_uri: SALESFORCE_REDIRECT_URI,
          code,
          code_verifier: codeVerifier,
        }),
      }
    );

    const tokens = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error("Salesforce token error:", tokens.error);
      return res.status(500).send("Could not exchange the authorization code.");
    }

    accessToken = tokens.access_token;
    refreshToken = tokens.refresh_token;
    instanceUrl = tokens.instance_url;

    // Never log accessToken or refreshToken.
    console.log("Salesforce connected.");
    console.log("Instance URL:", instanceUrl);

    oauthState = undefined;
    codeVerifier = undefined;

    res.redirect("/");
  } catch (error) {
    console.error(error.message);
    res.status(500).send("Unexpected server error.");
  }
});

async function runSoqlQuery(soql, res) {
  if (!accessToken || !instanceUrl) {
    return res.status(401).json({ message: "Connect Salesforce first." });
  }

  const url = new URL(`${instanceUrl}/services/data/v65.0/query`);
  url.searchParams.set("q", soql);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Salesforce API error:", data);
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: "Could not fetch Salesforce data." });
  }
}

// Accounts are Salesforce's equivalent of companies.
app.get("/api/accounts", (req, res) => {
  runSoqlQuery(
    "SELECT Id, Name, Industry, Phone, Website FROM Account LIMIT 10",
    res
  );
});

app.get("/api/leads", (req, res) => {
  runSoqlQuery(
    "SELECT Id, FirstName, LastName, Company, Email, Phone, Status FROM Lead LIMIT 10",
    res
  );
});

app.get("/api/contacts", (req, res) => {
  runSoqlQuery(
    "SELECT Id, FirstName, LastName, Email, Phone, Account.Name FROM Contact LIMIT 10",
    res
  );
});

app.get("/api/campaigns", (req, res) => {
  runSoqlQuery(
    `SELECT Id, Name, Owner.Name, IsActive, Type, Status, StartDate, EndDate,
      ExpectedRevenue, BudgetedCost, ActualCost, ExpectedResponse, NumberSent,
      Parent.Name, Description,
      NumberOfLeads, NumberOfConvertedLeads, NumberOfContacts, NumberOfResponses,
      NumberOfOpportunities, NumberOfWonOpportunities,
      AmountAllOpportunities, AmountWonOpportunities
    FROM Campaign LIMIT 10`,
    res
  );
});

app.get("/api/opportunities", (req, res) => {
  runSoqlQuery(
    `SELECT Id, Name, Account.Name, Owner.Name, Amount, ExpectedRevenue,
      Probability, StageName, Type, LeadSource, CloseDate,
      IsClosed, IsWon, NextStep, Description, Campaign.Name,
      OrderNumber__c, CurrentGenerators__c, TrackingNumber__c,
      MainCompetitors__c, DeliveryInstallationStatus__c,
      CreatedDate, LastModifiedDate
    FROM Opportunity ORDER BY CreatedDate DESC LIMIT 50`,
    res
  );
});

app.listen(PORT, () => {
  console.log(`Open http://localhost:${PORT}`);
});
