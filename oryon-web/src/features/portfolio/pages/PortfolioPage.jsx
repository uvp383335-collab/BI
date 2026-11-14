import { useCallback, useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { AppShell } from '../../../widgets/AppShell';
import { useAuthContext } from '../../../shared/context/AuthContext';
import { TopBar, PAGES } from '../components/Shell.jsx';
import Drawer from '../components/Drawer.jsx';
import Overview from './Overview.jsx';
import Family from './Family.jsx';
import Alerts from './Alerts.jsx';
import { Loading, ErrorBox } from '../components/ui.jsx';
import { portfolioApi } from '../api/portfolioApi';
import { useView, useAsync } from '../lib/useView.js';

/**
 * The Oryon AI portfolio screens (overview, metric families, alerts) for the signed-in
 * organization. `/` is the overview; `/portfolio/:section` is a family (VC, CB, CM) or alerts.
 * Owns the shared view state (period, granularity, timeline, units) and the metric drawer.
 */
export default function PortfolioPage() {
  const { section = 'overview' } = useParams();
  const { organization } = useAuthContext();
  const companyId = organization?.id;
  const meta = useAsync(() => (companyId ? portfolioApi.meta() : Promise.resolve(null)), [companyId]);
  const [view, set] = useView(meta.data);
  const [metricId, setMetricId] = useState(null);
  const closeDrawer = useCallback(() => setMetricId(null), []);
  useEffect(() => { document.title = organization ? `Oryon AI · ${organization.name}` : 'Oryon AI'; }, [organization]);

  const known = section === 'overview' || section === 'alerts' || (meta.data && section in meta.data.families);
  if (meta.data && !known) return <Navigate to="/" replace />;

  const title = PAGES.find(([k]) => k === section)?.[1] || 'Overview';
  const ready = meta.data && view.quarter;
  const props = { companyId, meta: meta.data, view, set, openMetric: setMetricId };

  return (
    <AppShell title={title} header={ready ? <TopBar meta={meta.data} view={view} set={set} title={title} /> : undefined}>
      {meta.error && <ErrorBox error={meta.error} />}
      {!meta.error && !ready && <Loading what="Loading" />}
      {ready && section === 'overview' && <Overview {...props} />}
      {ready && section in meta.data.families && <Family {...props} family={section} />}
      {ready && section === 'alerts' && <Alerts {...props} />}
      {ready && metricId && <Drawer companyId={companyId} meta={meta.data} view={view} metricId={metricId} onClose={closeDrawer} />}
    </AppShell>
  );
}
