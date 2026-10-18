import { useEffect, useState } from 'react';
import { useBuildLitePrincipal } from '../auth/BuildLiteAuthProvider';
import { getHomeDashboard } from '../api/homeDashboard';

const KPI_LABELS = {
  liveDevelopments: 'Live Developments',
  cvrAwaitingApproval: 'CVRs Awaiting Approval',
  certificatesRequiringReview: 'Certificates Requiring Review',
  openCommercialEvents: 'Open Commercial Events',
};

function formatWhen(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}

function DashboardState({ children }) {
  return <p className="buildlite-home-dashboard__state">{children}</p>;
}

export default function BuildLiteHome({ onNavigate }) {
  const principal = useBuildLitePrincipal();
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState('');
  const tenant = principal?.activeTenant?.name || principal?.activeTenant?.code || 'your organisation';
  useEffect(() => {
    let active = true;
    setDashboard(null); setError('');
    getHomeDashboard().then(data => { if (active) setDashboard(data); }).catch(loadError => { if (active) setError(loadError.message); });
    return () => { active = false; };
  }, [principal?.activeTenant?.clientId]);

  const metrics = dashboard?.overview?.metrics || {};
  const visibleMetrics = Object.entries(KPI_LABELS).filter(([key]) => metrics[key]?.state !== 'restricted');
  return <section className="buildlite-home">
    <header className="buildlite-home__header">
      <div className="buildlite-home__flow" aria-hidden="true">
        <svg viewBox="0 0 1200 260" preserveAspectRatio="none">
          <defs>
            <linearGradient id="home-flow-emerald" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#145d45" stopOpacity="0" />
              <stop offset=".32" stopColor="#3ccf91" stopOpacity=".34" />
              <stop offset=".7" stopColor="#7cffad" stopOpacity=".62" />
              <stop offset="1" stopColor="#b6ffd1" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="home-flow-gold" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#d8bb68" stopOpacity="0" />
              <stop offset=".56" stopColor="#d8bb68" stopOpacity=".2" />
              <stop offset="1" stopColor="#d8bb68" stopOpacity="0" />
            </linearGradient>
            <radialGradient id="home-flow-particle">
              <stop offset="0" stopColor="#caffdf" stopOpacity=".95" />
              <stop offset="1" stopColor="#42d696" stopOpacity=".08" />
            </radialGradient>
            <filter id="home-flow-blur" x="-25%" y="-80%" width="150%" height="260%">
              <feGaussianBlur stdDeviation="15" />
            </filter>
          </defs>
          <g className="buildlite-home__flow-glow" filter="url(#home-flow-blur)">
            <path d="M-90 226C109 211 178 117 358 143S563 236 755 159 956 59 1288 107" />
          </g>
          <g className="buildlite-home__flow-wave buildlite-home__flow-wave--back">
            <path d="M-110 224C70 221 155 148 315 156S535 231 705 187 933 82 1290 125" />
            <path d="M-100 246C101 241 183 182 346 187S556 241 734 205 968 110 1300 143" />
          </g>
          <g className="buildlite-home__flow-wave buildlite-home__flow-wave--middle">
            <path d="M-100 199C94 191 183 108 350 130S557 220 733 161 958 55 1300 91" />
            <path d="M-100 216C87 207 176 136 337 149S554 226 727 179 953 77 1300 111" />
            <path d="M-100 235C97 225 195 163 353 169S566 232 742 195 969 99 1300 132" />
          </g>
          <g className="buildlite-home__flow-wave buildlite-home__flow-wave--front">
            <path d="M-100 181C92 170 188 82 355 111S561 207 738 141 970 35 1300 71" />
            <path d="M-100 190C89 182 185 96 353 120S560 214 736 151 966 44 1300 80" />
          </g>
          <g className="buildlite-home__flow-particles buildlite-home__flow-particles--slow">
            <path d="M-100 224C70 221 155 148 315 156S535 231 705 187 933 82 1290 125" />
            <path d="M-100 246C101 241 183 182 346 187S556 241 734 205 968 110 1300 143" />
          </g>
          <g className="buildlite-home__flow-particles buildlite-home__flow-particles--fast">
            <path d="M-100 199C94 191 183 108 350 130S557 220 733 161 958 55 1300 91" />
            <path d="M-100 181C92 170 188 82 355 111S561 207 738 141 970 35 1300 71" />
          </g>
          <g className="buildlite-home__flow-specks">
            <circle cx="334" cy="139" r="7" /><circle cx="421" cy="165" r="3" />
            <circle cx="517" cy="194" r="5" /><circle cx="648" cy="185" r="3" />
            <circle cx="758" cy="149" r="6" /><circle cx="869" cy="97" r="3" />
            <circle cx="982" cy="76" r="5" /><circle cx="1094" cy="84" r="2.5" />
          </g>
          <g className="buildlite-home__flow-facts">
            <text x="355" y="91">£</text><text x="474" y="119">CVR</text>
            <text x="604" y="91">GP</text><text x="729" y="118">EFC</text>
            <text x="846" y="61">£</text><text x="1010" y="116">CVR</text>
          </g>
          <path className="buildlite-home__flow-gold" d="M40 238C239 225 320 213 470 222S730 252 910 196 1071 147 1230 160" />
        </svg>
      </div>
      <div className="buildlite-home__welcome">
        <p className="buildlite-home__eyebrow">Lean commercial control</p>
        <h1>Welcome to BuildLite</h1>
        {principal?.user?.displayName ? <p className="buildlite-home__user">{principal.user.displayName}</p> : null}
        <p className="buildlite-home__tenant">Company: {tenant}</p>
      </div>
    </header>
    <section className="buildlite-home-dashboard" aria-label="Commercial dashboard">
      <div className="buildlite-home-dashboard__heading"><div><p>Commercial position</p><h2>Commercial overview</h2></div>{dashboard?.generatedAt ? <span>Updated {formatWhen(dashboard.generatedAt)}</span> : null}</div>
      {error ? <div className="buildlite-home-dashboard__error" role="alert"><strong>Dashboard unavailable</strong><span>{error}</span><button type="button" onClick={() => window.location.reload()}>Try again</button></div> : null}
      {!dashboard && !error ? <DashboardState>Loading your commercial overview…</DashboardState> : null}
      {dashboard ? <>
        <div className="buildlite-home-dashboard__kpis">
          {visibleMetrics.map(([key, label]) => <article className="buildlite-home-dashboard__kpi" key={key}>
            <span>{label}</span>
            {metrics[key].state === 'ready' ? <strong>{metrics[key].value}</strong> : <strong aria-label="Unavailable">—</strong>}
            <small>{metrics[key].state === 'ready' ? 'Current authorised evidence' : metrics[key].message}</small>
          </article>)}
        </div>
        <div className="buildlite-home-dashboard__columns">
          <section className="buildlite-home-dashboard__panel buildlite-home-dashboard__panel--attention">
            <header><div><p>Priority work</p><h2>Your Attention Required</h2></div>{dashboard.attention.state !== 'unavailable' ? <span className="buildlite-home-dashboard__selection">Limited selection · up to {dashboard.attention.displayLimit || dashboard.attention.items.length}</span> : null}</header>
            {dashboard.attention.state === 'unavailable' ? <DashboardState>Actionable work is temporarily unavailable.</DashboardState> : null}
            {dashboard.attention.state === 'partial' ? <p className="buildlite-home-dashboard__notice">Some worklists are temporarily unavailable.</p> : null}
            {dashboard.attention.state !== 'unavailable' && !dashboard.attention.items.length ? <DashboardState>You have no outstanding actions.</DashboardState> : null}
            <ul>{dashboard.attention.items.map(item => <li key={item.id}>
              <span className="buildlite-home-dashboard__type">{item.type}</span><div><strong>{item.title}</strong><small>{item.detail}</small></div>
              <button type="button" onClick={() => onNavigate(item.destination)}>{item.status}</button>
            </li>)}</ul>
          </section>
          <section className="buildlite-home-dashboard__panel">
            <header><div><p>Recorded evidence</p><h2>Recent Activity</h2></div></header>
            {dashboard.activity.state === 'restricted' ? <DashboardState>Recent commercial activity is not available for your role.</DashboardState> : null}
            {dashboard.activity.state === 'unavailable' ? <DashboardState>{dashboard.activity.message}</DashboardState> : null}
            {dashboard.activity.state === 'ready' && !dashboard.activity.items.length ? <DashboardState>No recorded activity is available yet.</DashboardState> : null}
            <ol>{dashboard.activity.items.map(item => <li key={item.id}>
              <time dateTime={item.timestamp}>{formatWhen(item.timestamp)}</time><div><strong>{item.title}</strong><small>{item.action}{item.actor ? ` · ${item.actor}` : ''}</small></div>
              {item.destination ? <button type="button" aria-label={`Open ${item.title}`} onClick={() => onNavigate(item.destination)}>Open</button> : <span>{item.actor || 'Recorded actor unavailable'}</span>}
            </li>)}</ol>
          </section>
        </div>
      </> : null}
    </section>
  </section>;
}
