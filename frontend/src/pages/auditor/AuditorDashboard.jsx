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

const TABS = [
  { id: 'new',         label: 'New',         desc: 'Not started' },
  { id: 'inprogress',  label: 'In Progress',  desc: 'Scanning started' },
  { id: 'completed',   label: 'Completed',    desc: 'All matched' },
  { id: 'discrepancy', label: 'Discrepancy',  desc: 'Mismatch found' },
];

function binTab(status) {
  if (status === 'Pending')  return 'new';
  if (status === 'Scanning') return 'inprogress';
  if (status === 'Complete') return 'completed';
  return 'discrepancy'; // Short / Excess / Variance
}

function BinCard({ a, stats }) {
  const status = stats?.status || 'Pending';
  return (
    <Link
      to={`/auditor/scan/${encodeURIComponent(a.warehouse)}/${encodeURIComponent(a.binCode)}`}
      className="card flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer"
    >
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="font-medium text-gray-900">{a.warehouse}</span>
          <span className="text-gray-400">›</span>
          <span className="font-mono font-semibold">{a.binCode}</span>
          {a.lpnBoxId && (
            <span className="text-xs bg-amber-50 border border-amber-200 text-amber-700 px-2 py-0.5 rounded font-mono">
              📦 {a.lpnBoxId}
            </span>
          )}
          <span className={STATUS_BADGE[status] || 'badge-pending'}>{status}</span>
        </div>
        <div className="flex gap-4 text-sm text-gray-500">
          <span>Expected: <strong className="text-gray-700">{stats?.expected ?? '—'}</strong></span>
          <span>Matched: <strong className="text-green-700">{stats?.matched ?? '—'}</strong></span>
          <span>Remaining: <strong className="text-blue-700">{stats?.remaining ?? '—'}</strong></span>
          {stats?.variance > 0 && <span>Variance: <strong className="text-red-700">{stats.variance}</strong></span>}
        </div>
      </div>
      <ChevronRight size={20} className="text-gray-400 shrink-0" />
    </Link>
  );
}

export default function AuditorDashboard() {
  const [rows, setRows] = useState([]);   // each row = { ...assignment, stats }
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('new');

  useEffect(() => {
    api.get('/assignments/my-with-stats')
      .then(r => setRows(r.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-gray-400">Loading your assignments…</p>;

  const tabGroups = { new: [], inprogress: [], completed: [], discrepancy: [] };
  for (const row of rows) {
    const tab = binTab(row.stats?.status || 'Pending');
    tabGroups[tab].push(row);
  }

  const visibleBins = tabGroups[activeTab] || [];

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-4">My Assigned Bins</h2>

      {rows.length === 0 ? (
        <div className="card text-center py-12">
          <ScanLine size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">No bins assigned to you yet.</p>
          <p className="text-gray-400 text-sm">Your manager will assign bins once inventory is uploaded.</p>
        </div>
      ) : (
        <>
          {/* Tab bar */}
          <div className="flex gap-1 mb-4 border-b border-gray-200">
            {TABS.map(tab => {
              const count = tabGroups[tab.id].length;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap -mb-px ${
                    isActive
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab.label}
                  <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                    isActive ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {visibleBins.length === 0 ? (
            <div className="card text-center py-10 text-gray-400">
              <p>No bins in this category.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleBins.map(row => (
                <BinCard key={row.id} a={row} stats={row.stats} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
