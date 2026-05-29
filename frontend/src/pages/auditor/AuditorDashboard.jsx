import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { ScanLine, ChevronRight } from 'lucide-react';

const STATUS_BADGE = {
  Complete: 'badge-complete',
  Short: 'badge-short',
  Excess: 'badge-excess',
  Variance: 'badge-variance',
  Pending: 'badge-pending',
  Scanning: 'badge-scanning',
};

export default function AuditorDashboard() {
  const [assignments, setAssignments] = useState([]);
  const [binStats, setBinStats] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await api.get('/assignments/my');
      setAssignments(data);

      // Load stats for each bin
      const statsMap = {};
      await Promise.allSettled(
        data.map(async a => {
          const sessions = await api.get('/sessions/my');
          const latestSession = sessions.data.find(s => s.warehouse === a.warehouse);
          if (!latestSession) {
            statsMap[`${a.warehouse}::${a.binCode}`] = { status: 'Pending', matched: 0, expected: 0, variance: 0, remaining: 0 };
            return;
          }
          const { data: stats } = await api.get(`/sessions/${latestSession.id}/bin-stats/${a.binCode}`);
          statsMap[`${a.warehouse}::${a.binCode}`] = stats;
        })
      );
      setBinStats(statsMap);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <p className="text-gray-400">Loading your assignments…</p>;

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-6">My Assigned Bins</h2>

      {assignments.length === 0 ? (
        <div className="card text-center py-12">
          <ScanLine size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">No bins assigned to you yet.</p>
          <p className="text-gray-400 text-sm">Your manager will assign bins once inventory is uploaded.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {assignments.map(a => {
            const key = `${a.warehouse}::${a.binCode}`;
            const stats = binStats[key] || {};
            const status = stats.status || 'Pending';
            return (
              <Link
                key={a.id}
                to={`/auditor/scan/${encodeURIComponent(a.warehouse)}/${encodeURIComponent(a.binCode)}`}
                className="card flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-gray-900">{a.warehouse}</span>
                    <span className="text-gray-400">›</span>
                    <span className="font-mono font-semibold">{a.binCode}</span>
                    <span className={STATUS_BADGE[status] || 'badge-pending'}>{status}</span>
                  </div>
                  <div className="flex gap-4 text-sm text-gray-500">
                    <span>Expected: <strong className="text-gray-700">{stats.expected ?? '—'}</strong></span>
                    <span>Matched: <strong className="text-green-700">{stats.matched ?? '—'}</strong></span>
                    <span>Remaining: <strong className="text-blue-700">{stats.remaining ?? '—'}</strong></span>
                    {stats.variance > 0 && <span>Variance: <strong className="text-red-700">{stats.variance}</strong></span>}
                  </div>
                </div>
                <ChevronRight size={20} className="text-gray-400 shrink-0" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
