import { useState } from 'react';
import { Pill, Seg, Loading, ErrorBox, Card } from '../components/ui.jsx';
import { portfolioApi as api } from '../api/portfolioApi';
import { useAsync } from '../lib/useView.js';
import { pLabel } from '../lib/format.js';

export default function Alerts({ companyId, meta, view, openMetric }) {
  const [flag, setFlag] = useState('All');
  const { data, error } = useAsync(() => api.alerts(view), [companyId, view.quarter, view.month, view.gran]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading what="Loading alerts" />;
  const list = data.alerts.filter((a) => flag === 'All' || a.flag === flag).sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : a.flag === 'Act now' ? -1 : 1));
  const name = (id) => meta.metrics.find((m) => m.id === id)?.name;
  return (
    <>
      <div className="sec-h"><p>Every flag raised by the metric rules over the last {data.quarters.length} quarters.</p></div>
      <Card title={`${list.length} flags`} sub={`${pLabel(data.quarters[0])} to ${pLabel(data.quarters.at(-1))}`}
        right={<Seg id="af" label="Flag" value={flag} onChange={setFlag} options={[['All', 'All'], ['Act now', 'Act now'], ['Watch', 'Watch']]} />}>
        <div className="tw"><table className="t">
          <thead><tr><th>Quarter</th><th>Flag</th><th>Metric</th><th>Why</th></tr></thead>
          <tbody>{list.map((a) => (
            <tr key={`${a.period}-${a.id}`} className="click" onClick={() => openMetric(a.id)}>
              <td>{pLabel(a.period)}</td><td><Pill flag={a.flag} /></td><td><b style={{ fontFamily: 'var(--f-mono)', fontSize: 11, marginRight: 8 }}>{a.id}</b>{name(a.id)}</td><td style={{ color: 'var(--muted)' }}>{a.why}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </Card>
    </>
  );
}
