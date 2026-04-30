import { useState, useCallback } from "react";

// ─── Minimal X API helpers (client-side, Bearer token) ───────────────────────
// NOTE: All write actions (follow) are gated behind manual approval.
// Bulk auto-follow is intentionally NOT supported to comply with X rules.

const XAPI = {
  baseUrl: "https://api.twitter.com/2",

  headers(bearerToken) {
    return {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
    };
  },

  async searchUsers(bearerToken, query, maxResults = 10) {
    const params = new URLSearchParams({
      query,
      max_results: Math.min(maxResults, 20), // cap for safety
      "user.fields":
        "description,public_metrics,profile_image_url,verified,entities,url",
    });
    const res = await fetch(
      `${this.baseUrl}/users/search?${params}`,
      { headers: this.headers(bearerToken) }
    );
    if (!res.ok) throw new Error(`X API error ${res.status}: ${await res.text()}`);
    return res.json();
  },

  async getMyId(bearerToken) {
    const res = await fetch(`${this.baseUrl}/users/me`, {
      headers: this.headers(bearerToken),
    });
    if (!res.ok) throw new Error(`X API error ${res.status}`);
    const data = await res.json();
    return data.data.id;
  },

  // Single manual follow — requires OAuth 2.0 user token (not just bearer)
  async followUser(userToken, myId, targetId) {
    const res = await fetch(`${this.baseUrl}/users/${myId}/following`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ target_user_id: targetId }),
    });
    if (!res.ok) throw new Error(`Follow failed ${res.status}: ${await res.text()}`);
    return res.json();
  },
};

// ─── AI Scoring via Anthropic API ────────────────────────────────────────────
async function scoreAccountsWithAI(accounts, criteria) {
  const prompt = `You are an expert at evaluating Twitter/X accounts. 
Given these accounts and the user's search criteria, score and rank each account.

User criteria: "${criteria}"

Accounts to evaluate:
${accounts
  .map(
    (a, i) => `${i + 1}. @${a.username} — "${a.name}"
   Bio: ${a.description || "(no bio)"}
   Followers: ${a.public_metrics?.followers_count ?? "?"} | Following: ${a.public_metrics?.following_count ?? "?"} | Tweets: ${a.public_metrics?.tweet_count ?? "?"}`
  )
  .join("\n\n")}

Respond ONLY with a valid JSON array (no markdown, no explanation outside JSON):
[
  {
    "username": "handle",
    "score": 0-100,
    "matchSummary": "2-sentence explanation of why this account matches the criteria",
    "tags": ["tag1", "tag2"],
    "verdict": "Strong Match" | "Good Match" | "Partial Match" | "Weak Match"
  }
]`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  const text = data.content.map((b) => b.text || "").join("");
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0a0a0f;
    --surface: #111118;
    --border: #1e1e2e;
    --accent: #7c6af7;
    --accent2: #f7a26a;
    --green: #4ade80;
    --red: #f87171;
    --yellow: #fbbf24;
    --text: #e8e8f0;
    --muted: #6b6b80;
    --radius: 12px;
  }

  body { background: var(--bg); color: var(--text); font-family: 'Syne', sans-serif; }

  .app {
    min-height: 100vh;
    background: var(--bg);
    padding: 0 0 60px;
  }

  /* Header */
  .header {
    border-bottom: 1px solid var(--border);
    padding: 20px 32px;
    display: flex;
    align-items: center;
    gap: 16px;
    background: rgba(10,10,15,0.95);
    position: sticky;
    top: 0;
    z-index: 100;
    backdrop-filter: blur(12px);
  }
  .header-icon { font-size: 22px; }
  .header-title { font-size: 18px; font-weight: 800; letter-spacing: -0.5px; }
  .header-title span { color: var(--accent); }
  .header-badge {
    margin-left: auto;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: var(--muted);
    border: 1px solid var(--border);
    padding: 3px 10px;
    border-radius: 999px;
    background: var(--surface);
  }
  .header-badge.safe { border-color: var(--green); color: var(--green); }

  /* Layout */
  .layout { display: grid; grid-template-columns: 340px 1fr; min-height: calc(100vh - 65px); }

  /* Sidebar */
  .sidebar {
    border-right: 1px solid var(--border);
    padding: 28px 24px;
    display: flex;
    flex-direction: column;
    gap: 28px;
  }

  .section-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 12px;
  }

  .input-field {
    width: 100%;
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 10px 14px;
    border-radius: var(--radius);
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    outline: none;
    transition: border-color 0.2s;
  }
  .input-field:focus { border-color: var(--accent); }
  .input-field::placeholder { color: var(--muted); }

  textarea.input-field { resize: vertical; min-height: 80px; line-height: 1.6; }

  .token-notice {
    font-size: 11px;
    color: var(--muted);
    margin-top: 6px;
    line-height: 1.5;
  }
  .token-notice a { color: var(--accent); text-decoration: none; }

  .btn {
    width: 100%;
    padding: 12px 20px;
    border-radius: var(--radius);
    font-family: 'Syne', sans-serif;
    font-weight: 700;
    font-size: 14px;
    cursor: pointer;
    border: none;
    transition: all 0.2s;
    letter-spacing: 0.2px;
  }
  .btn-primary {
    background: var(--accent);
    color: #fff;
  }
  .btn-primary:hover:not(:disabled) { background: #9080ff; transform: translateY(-1px); }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

  .safety-box {
    background: rgba(74, 222, 128, 0.05);
    border: 1px solid rgba(74, 222, 128, 0.2);
    border-radius: var(--radius);
    padding: 14px;
    font-size: 12px;
    color: #a8f5c4;
    line-height: 1.7;
  }
  .safety-box ul { list-style: none; padding: 0; }
  .safety-box li::before { content: "✓ "; color: var(--green); font-weight: 700; }

  /* Main panel */
  .main { padding: 32px; }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 60vh;
    color: var(--muted);
    gap: 12px;
    text-align: center;
  }
  .empty-icon { font-size: 48px; opacity: 0.3; }
  .empty-title { font-size: 18px; font-weight: 700; color: var(--text); opacity: 0.5; }
  .empty-sub { font-size: 13px; max-width: 300px; line-height: 1.6; }

  .results-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 24px;
  }
  .results-title { font-size: 20px; font-weight: 800; }
  .results-count {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    color: var(--muted);
    background: var(--surface);
    border: 1px solid var(--border);
    padding: 3px 10px;
    border-radius: 999px;
  }

  .cards-grid { display: grid; gap: 16px; }

  /* Account card */
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 22px;
    display: grid;
    grid-template-columns: 56px 1fr auto;
    gap: 16px;
    align-items: start;
    transition: border-color 0.2s, transform 0.15s;
    position: relative;
    overflow: hidden;
  }
  .card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 2px;
    background: linear-gradient(90deg, var(--accent), var(--accent2));
    opacity: 0;
    transition: opacity 0.2s;
  }
  .card:hover { border-color: #2e2e44; transform: translateY(-2px); }
  .card:hover::before { opacity: 1; }
  .card.approved { border-color: rgba(74,222,128,0.3); }
  .card.approved::before { opacity: 1; background: var(--green); }
  .card.followed { border-color: rgba(124,106,247,0.3); opacity: 0.6; }

  .avatar {
    width: 52px; height: 52px;
    border-radius: 50%;
    background: var(--border);
    object-fit: cover;
    border: 2px solid var(--border);
  }
  .avatar-placeholder {
    width: 52px; height: 52px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--accent), var(--accent2));
    display: flex; align-items: center; justify-content: center;
    font-size: 20px; font-weight: 800; color: #fff;
    flex-shrink: 0;
  }

  .card-body { min-width: 0; }
  .card-top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
  .card-name { font-weight: 700; font-size: 15px; }
  .card-handle {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    color: var(--muted);
  }

  .verdict-badge {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    font-weight: 500;
    padding: 3px 8px;
    border-radius: 999px;
    border: 1px solid;
  }
  .verdict-strong { color: var(--green); border-color: rgba(74,222,128,0.4); background: rgba(74,222,128,0.08); }
  .verdict-good { color: var(--accent); border-color: rgba(124,106,247,0.4); background: rgba(124,106,247,0.08); }
  .verdict-partial { color: var(--yellow); border-color: rgba(251,191,36,0.4); background: rgba(251,191,36,0.08); }
  .verdict-weak { color: var(--muted); border-color: var(--border); }

  .card-bio {
    font-size: 13px;
    color: #a0a0b8;
    margin: 6px 0 10px;
    line-height: 1.55;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .card-match {
    font-size: 12px;
    color: #c0c0d8;
    line-height: 1.55;
    margin-bottom: 12px;
    padding: 10px 12px;
    background: rgba(124,106,247,0.06);
    border-left: 2px solid var(--accent);
    border-radius: 0 8px 8px 0;
  }

  .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
  .tag {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: var(--muted);
    border: 1px solid var(--border);
    padding: 2px 8px;
    border-radius: 999px;
  }

  .metrics { display: flex; gap: 16px; }
  .metric { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--muted); }
  .metric span { color: var(--text); font-weight: 600; }

  /* Score ring */
  .score-col { display: flex; flex-direction: column; align-items: center; gap: 8px; min-width: 70px; }
  .score-ring {
    width: 60px; height: 60px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 18px; font-weight: 800;
    background: conic-gradient(var(--accent) calc(var(--pct) * 1%), var(--border) 0);
    position: relative;
  }
  .score-ring::after {
    content: '';
    position: absolute;
    width: 46px; height: 46px;
    border-radius: 50%;
    background: var(--surface);
  }
  .score-num { position: relative; z-index: 1; font-size: 16px; }
  .score-label { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: var(--muted); letter-spacing: 1px; }

  /* Follow button */
  .follow-btn {
    width: 100%;
    padding: 9px;
    border-radius: 8px;
    font-family: 'Syne', sans-serif;
    font-weight: 700;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
    letter-spacing: 0.3px;
    margin-top: 6px;
  }
  .follow-btn-approve {
    background: rgba(124,106,247,0.12);
    border: 1px solid rgba(124,106,247,0.3);
    color: var(--accent);
  }
  .follow-btn-approve:hover { background: var(--accent); color: #fff; }
  .follow-btn-confirm {
    background: rgba(74,222,128,0.1);
    border: 1px solid rgba(74,222,128,0.4);
    color: var(--green);
    animation: pulse 1.5s infinite;
  }
  @keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(74,222,128,0.3); } 50% { box-shadow: 0 0 0 6px rgba(74,222,128,0); } }
  .follow-btn-followed {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--muted);
    cursor: default;
  }

  /* Spinner */
  .spinner {
    width: 16px; height: 16px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    display: inline-block;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Error */
  .error-bar {
    background: rgba(248,113,113,0.1);
    border: 1px solid rgba(248,113,113,0.3);
    color: #fca5a5;
    border-radius: var(--radius);
    padding: 12px 16px;
    font-size: 13px;
    margin-bottom: 20px;
    line-height: 1.5;
  }

  /* Loading */
  .loading-bar {
    background: rgba(124,106,247,0.1);
    border: 1px solid rgba(124,106,247,0.2);
    border-radius: var(--radius);
    padding: 20px;
    text-align: center;
    color: var(--accent);
    font-size: 14px;
    display: flex; align-items: center; justify-content: center; gap: 12px;
  }

  @media (max-width: 768px) {
    .layout { grid-template-columns: 1fr; }
    .sidebar { border-right: none; border-bottom: 1px solid var(--border); }
    .card { grid-template-columns: 52px 1fr; }
    .score-col { display: none; }
  }
`;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function verdictClass(v = "") {
  if (v.includes("Strong")) return "verdict-strong";
  if (v.includes("Good")) return "verdict-good";
  if (v.includes("Partial")) return "verdict-partial";
  return "verdict-weak";
}

function fmtNum(n) {
  if (!n && n !== 0) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function XDiscoveryTool() {
  // Config state
  const [bearerToken, setBearerToken] = useState("");
  const [userToken, setUserToken] = useState("");
  const [criteria, setCriteria] = useState("");
  const [maxResults, setMaxResults] = useState(10);

  // Result state
  const [accounts, setAccounts] = useState([]); // raw from X API
  const [scored, setScored] = useState([]);      // AI-scored, ranked
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState("");

  // Per-card state: idle | approved | following | followed | error
  const [cardState, setCardState] = useState({});
  const [myId, setMyId] = useState(null);

  const setCard = (username, state) =>
    setCardState((prev) => ({ ...prev, [username]: state }));

  const search = useCallback(async () => {
    if (!bearerToken.trim() || !criteria.trim()) return;
    setError("");
    setScored([]);
    setCardState({});
    setLoading(true);

    try {
      setLoadingMsg("Searching X for matching accounts…");
      const data = await XAPI.searchUsers(bearerToken, criteria, maxResults);
      const users = data.data || [];
      if (!users.length) {
        setError("No accounts found for that query. Try different keywords.");
        setLoading(false);
        return;
      }
      setAccounts(users);

      setLoadingMsg("Scoring and ranking with AI…");
      const scores = await scoreAccountsWithAI(users, criteria);

      // Merge API data + AI scores, sort by score desc
      const merged = scores
        .map((s) => {
          const raw = users.find((u) => u.username === s.username) || {};
          return { ...raw, ...s };
        })
        .filter((a) => a.username)
        .sort((a, b) => (b.score || 0) - (a.score || 0));

      setScored(merged);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setLoadingMsg("");
    }
  }, [bearerToken, criteria, maxResults]);

  const handleApprove = (username) => setCard(username, "approved");

  const handleFollow = async (account) => {
    if (!userToken.trim()) {
      setError("An OAuth 2.0 User Token is required to follow accounts.");
      return;
    }
    setCard(account.username, "following");
    try {
      if (!myId) {
        const id = await XAPI.getMyId(userToken);
        setMyId(id);
        await XAPI.followUser(userToken, id, account.id);
      } else {
        await XAPI.followUser(userToken, myId, account.id);
      }
      setCard(account.username, "followed");
    } catch (e) {
      setCard(account.username, "error");
      setError(`Failed to follow @${account.username}: ${e.message}`);
    }
  };

  const state = (username) => cardState[username] || "idle";

  return (
    <>
      <style>{css}</style>
      <div className="app">
        {/* Header */}
        <header className="header">
          <span className="header-icon">𝕏</span>
          <span className="header-title">Account <span>Discovery</span> Tool</span>
          <span className="header-badge safe">✓ Manual Approval Only</span>
        </header>

        <div className="layout">
          {/* Sidebar */}
          <aside className="sidebar">

            {/* API Tokens */}
            <div>
              <div className="section-label">X API Credentials</div>
              <input
                className="input-field"
                type="password"
                placeholder="Bearer Token (search)"
                value={bearerToken}
                onChange={(e) => setBearerToken(e.target.value)}
                style={{ marginBottom: 10 }}
              />
              <input
                className="input-field"
                type="password"
                placeholder="OAuth 2.0 User Token (follow)"
                value={userToken}
                onChange={(e) => setUserToken(e.target.value)}
              />
              <p className="token-notice">
                Bearer Token is needed for search. A User Token is needed only when you manually approve a follow.{" "}
                <a href="https://developer.x.com/en/portal/dashboard" target="_blank" rel="noreferrer">
                  Get tokens →
                </a>
              </p>
            </div>

            {/* Search Criteria */}
            <div>
              <div className="section-label">Discovery Criteria</div>
              <textarea
                className="input-field"
                placeholder="e.g. AI safety researchers who tweet about alignment, interpretability, and policy"
                value={criteria}
                onChange={(e) => setCriteria(e.target.value)}
                rows={4}
              />
            </div>

            {/* Max Results */}
            <div>
              <div className="section-label">Max Results</div>
              <select
                className="input-field"
                value={maxResults}
                onChange={(e) => setMaxResults(Number(e.target.value))}
              >
                {[5, 10, 15, 20].map((n) => (
                  <option key={n} value={n}>{n} accounts</option>
                ))}
              </select>
            </div>

            {/* Search Button */}
            <button
              className="btn btn-primary"
              onClick={search}
              disabled={loading || !bearerToken.trim() || !criteria.trim()}
            >
              {loading ? "Searching…" : "Discover Accounts"}
            </button>

            {/* Safety Notice */}
            <div className="safety-box">
              <div style={{ fontWeight: 700, marginBottom: 8, color: "#4ade80" }}>Safety Guarantees</div>
              <ul>
                <li>No bulk or automated following</li>
                <li>Each follow requires your click</li>
                <li>Two-step approval before any action</li>
                <li>Compliant with X automation rules</li>
                <li>Tokens stay in your browser only</li>
              </ul>
            </div>
          </aside>

          {/* Main */}
          <main className="main">
            {error && <div className="error-bar">⚠ {error}</div>}

            {loading && (
              <div className="loading-bar">
                <span className="spinner" /> {loadingMsg}
              </div>
            )}

            {!loading && scored.length === 0 && (
              <div className="empty-state">
                <div className="empty-icon">🔭</div>
                <div className="empty-title">No results yet</div>
                <div className="empty-sub">
                  Enter your discovery criteria on the left and click "Discover Accounts" to get started.
                </div>
              </div>
            )}

            {scored.length > 0 && (
              <>
                <div className="results-header">
                  <div className="results-title">Recommended Accounts</div>
                  <div className="results-count">{scored.length} found</div>
                </div>
                <div className="cards-grid">
                  {scored.map((account) => {
                    const cs = state(account.username);
                    const pct = account.score || 0;
                    const initial = (account.name || account.username || "?")[0].toUpperCase();

                    return (
                      <div
                        key={account.username}
                        className={`card ${cs === "approved" ? "approved" : ""} ${cs === "followed" ? "followed" : ""}`}
                      >
                        {/* Avatar */}
                        {account.profile_image_url ? (
                          <img
                            src={account.profile_image_url.replace("_normal", "_bigger")}
                            alt={account.name}
                            className="avatar"
                          />
                        ) : (
                          <div className="avatar-placeholder">{initial}</div>
                        )}

                        {/* Body */}
                        <div className="card-body">
                          <div className="card-top">
                            <span className="card-name">{account.name}</span>
                            <span className="card-handle">@{account.username}</span>
                            <span className={`verdict-badge ${verdictClass(account.verdict)}`}>
                              {account.verdict || "Unscored"}
                            </span>
                          </div>

                          {account.description && (
                            <div className="card-bio">{account.description}</div>
                          )}

                          {account.matchSummary && (
                            <div className="card-match">💡 {account.matchSummary}</div>
                          )}

                          {account.tags?.length > 0 && (
                            <div className="tags">
                              {account.tags.map((t) => (
                                <span key={t} className="tag">{t}</span>
                              ))}
                            </div>
                          )}

                          <div className="metrics">
                            <div className="metric">
                              <span>{fmtNum(account.public_metrics?.followers_count)}</span> followers
                            </div>
                            <div className="metric">
                              <span>{fmtNum(account.public_metrics?.tweet_count)}</span> tweets
                            </div>
                          </div>

                          {/* Follow action — two-step */}
                          {cs === "idle" && (
                            <button
                              className="follow-btn follow-btn-approve"
                              onClick={() => handleApprove(account.username)}
                            >
                              + Approve to Follow
                            </button>
                          )}
                          {cs === "approved" && (
                            <button
                              className="follow-btn follow-btn-confirm"
                              onClick={() => handleFollow(account)}
                            >
                              ✓ Confirm Follow @{account.username}
                            </button>
                          )}
                          {cs === "following" && (
                            <button className="follow-btn follow-btn-followed" disabled>
                              <span className="spinner" style={{ borderTopColor: "#fff" }} /> Following…
                            </button>
                          )}
                          {cs === "followed" && (
                            <button className="follow-btn follow-btn-followed" disabled>
                              ✓ Following
                            </button>
                          )}
                          {cs === "error" && (
                            <button
                              className="follow-btn follow-btn-approve"
                              onClick={() => handleApprove(account.username)}
                            >
                              Retry
                            </button>
                          )}
                        </div>

                        {/* Score ring */}
                        <div className="score-col">
                          <div
                            className="score-ring"
                            style={{ "--pct": pct }}
                          >
                            <span className="score-num">{pct}</span>
                          </div>
                          <span className="score-label">SCORE</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    </>
  );
}
