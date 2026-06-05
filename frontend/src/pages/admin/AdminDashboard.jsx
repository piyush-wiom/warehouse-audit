import { useEffect, useState } from 'react';
import api from '../../lib/api';
import { Users, Package, ClipboardList, Activity, Calendar, TrendingUp, AlertTriangle, ScanLine, ShieldCheck, ShieldAlert } from 'lucide-react';

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="card flex items-center gap-4">
      <div className={`p-3 rounded-xl ${color}`}>
        <Icon size={24} className="text-white" />
      </div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-2xl font-bold text-gray-900">{value ?? '—'}</p>
      </div>
    </div>
  );
}

const today = new Date().toISOString().slice(0, 10);
const sevenDaysAgo = (() => { const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10); })();

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [dateRange, setDateRange] = useState({ from: sevenDaysAgo, to: today });
  const [dailyStats, setDailyStats] = useState([]);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [auditorStats, setAuditorStats] = useState([]);
  const [auditorLoading, setAuditorLoading] = useState(false);

  useEffect(() => {
    async function load() {
      const [users, sessions, reconciliation] = await Promise.allSettled([
        api.get('/users'),
        api.get('/sessions'),
        api.get('/reconciliation'),
      ]);

      const userList = users.status === 'fulfilled' ? users.value.data : [];
      const sessionList = sessions.status === 'fulfilled' ? sessions.value.data : [];
      const reconList = reconciliation.status === 'fulfilled' ? reconciliation.value.data : [];

      const statusCounts = reconList.reduce((acc, r) => {
        acc[r.finalStatus] = (acc[r.finalStatus] || 0) + 1;
        return acc;
      }, {});

      setStats({
        totalUsers: userList.length,
        auditors: userList.filter(u => u.role === 'auditor').length,
        totalSessions: sessionList.length,
        activeSessions: sessionList.filter(s => !s.endTime).length,
        totalBins: reconList.length,
        completeBins: statusCounts['Complete'] || 0,
        flaggedBins: (statusCounts['Short'] || 0) + (statusCounts['Excess'] || 0) + (statusCounts['Variance'] || 0),
        pendingBins: statusCounts['Pending'] || 0,
      });
    }
    load();
  }, []);

  useEffect(() => {
    async function loadDaily() {
      setDailyLoading(true);
      try {
        const params = {};
        if (dateRange.from) params.date_from = dateRange.from;
        if (dateRange.to) params.date_to = dateRange.to;
        const { data } = await api.get('/reconciliation/daily-stats', { params });
        setDailyStats(data);
      } catch { }
      setDailyLoading(false);
    }
    loadDaily();
  }, [dateRange]);

  useEffect(() => {
    async function loadAuditorStats() {
      setAuditorLoading(true);
      try {
        const { data } = await api.get('/reconciliation/auditor-stats');
        setAuditorStats(data);
      } catch { }
      setAuditorLoading(false);
    }
    loadAuditorStats();
  }, []);

  const totalAuditsInRange = dailyStats.reduce((s, d) => s + d.totalAudits, 0);
  const avgCompletion = dailyStats.length > 0
    ? Math.round(dailyStats.reduce((s, d) => s + d.completionRate, 0) / dailyStats.length)
    : 0;
  const avgDiscrepancy = dailyStats.length > 0
    ? Math.round(dailyStats.reduce((s, d) => s + d.discrepancyRate, 0) / dailyStats.length)
    : 0;

  // Aggregate scans per auditor across range
  const auditorTotals = {};
  for (const d of dailyStats) {
    for (const [email, count] of Object.entries(d.auditorScans || {})) {
      auditorTotals[email] = (auditorTotals[email] || 0) + count;
    }
  }
  const auditorList = Object.entries(auditorTotals).sort((a, b) => b[1] - a[1]);

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-6">Dashboard</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon={Users} label="Total Users" value={stats?.totalUsers} color="bg-blue-500" />
        <StatCard icon={Activity} label="Active Sessions" value={stats?.activeSessions} color="bg-green-500" />
        <StatCard icon={Package} label="Total Bins" value={stats?.totalBins} color="bg-purple-500" />
        <StatCard icon={ClipboardList} label="Flagged Bins" value={stats?.flaggedBins} color="bg-red-500" />
      </div>

      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <div className="card">
            <h3 className="font-semibold text-gray-900 mb-4">Bin Status Summary</h3>
            <div className="space-y-3">
              {[
                { label: 'Complete', value: stats.completeBins, cls: 'badge-complete' },
                { label: 'Pending', value: stats.pendingBins, cls: 'badge-pending' },
                { label: 'Flagged (Short/Excess/Variance)', value: stats.flaggedBins, cls: 'badge-variance' },
              ].map(({ label, value, cls }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className={cls}>{label}</span>
                  <span className="font-semibold text-gray-900">{value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h3 className="font-semibold text-gray-900 mb-4">Audit Activity</h3>
            <div className="space-y-3">
              {[
                { label: 'Total Sessions', value: stats.totalSessions },
                { label: 'Active Sessions', value: stats.activeSessions },
                { label: 'Auditors', value: stats.auditors },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">{label}</span>
                  <span className="font-semibold text-gray-900">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Date-level metrics */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Daily Metrics</h3>
        <div className="flex items-center gap-2">
          <Calendar size={14} className="text-gray-400" />
          <input
            type="date"
            className="input py-1 text-sm"
            value={dateRange.from}
            max={dateRange.to}
            onChange={e => setDateRange(r => ({ ...r, from: e.target.value }))}
          />
          <span className="text-gray-400 text-sm">to</span>
          <input
            type="date"
            className="input py-1 text-sm"
            value={dateRange.to}
            min={dateRange.from}
            onChange={e => setDateRange(r => ({ ...r, to: e.target.value }))}
          />
        </div>
      </div>

      {/* Range summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <div className="card flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-blue-100"><ScanLine size={20} className="text-blue-600" /></div>
          <div>
            <p className="text-xs text-gray-500">Bins Audited</p>
            <p className="text-xl font-bold text-gray-900">{totalAuditsInRange}</p>
          </div>
        </div>
        <div className="card flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-green-100"><TrendingUp size={20} className="text-green-600" /></div>
          <div>
            <p className="text-xs text-gray-500">Avg Completion Rate</p>
            <p className="text-xl font-bold text-gray-900">{avgCompletion}%</p>
          </div>
        </div>
        <div className="card flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-red-100"><AlertTriangle size={20} className="text-red-600" /></div>
          <div>
            <p className="text-xs text-gray-500">Avg Discrepancy Rate</p>
            <p className="text-xl font-bold text-gray-900">{avgDiscrepancy}%</p>
          </div>
        </div>
      </div>

      {/* Auditor Performance */}
      <div className="mb-4 mt-8">
        <h3 className="font-semibold text-gray-900 mb-3">Auditor Performance</h3>
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Auditor', 'Assigned', 'Completed', 'Discrepancy', 'Scanning', 'Pending', 'Accuracy'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {auditorLoading ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">Loading…</td></tr>
              ) : auditorStats.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">No assignment data yet</td></tr>
              ) : auditorStats.map(a => (
                <tr key={a.email} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-700 font-medium">{a.email}</td>
                  <td className="px-4 py-3 text-center font-semibold">{a.assigned}</td>
                  <td className="px-4 py-3 text-center text-green-700 font-semibold">{a.completed}</td>
                  <td className="px-4 py-3 text-center text-red-600 font-semibold">{a.discrepancy}</td>
                  <td className="px-4 py-3 text-center text-blue-600">{a.scanning}</td>
                  <td className="px-4 py-3 text-center text-gray-400">{a.pending}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${a.accuracyRate >= 80 ? 'bg-green-500' : a.accuracyRate >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                          style={{ width: `${a.accuracyRate}%` }}
                        />
                      </div>
                      <span className={`text-xs font-bold w-10 text-right ${a.accuracyRate >= 80 ? 'text-green-700' : a.accuracyRate >= 50 ? 'text-yellow-700' : 'text-red-700'}`}>
                        {a.accuracyRate}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Per-day table */}
        <div className="card overflow-x-auto p-0">
          <div className="px-4 py-3 border-b border-gray-100">
            <h4 className="font-medium text-gray-800 text-sm">Day-by-day breakdown</h4>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Date', 'Bins', 'Completion', 'Discrepancy', 'Sessions'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {dailyLoading ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">Loading…</td></tr>
              ) : dailyStats.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">No data for selected range</td></tr>
              ) : (
                dailyStats.map(d => (
                  <tr key={d.date} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-xs text-gray-700">{d.date}</td>
                    <td className="px-3 py-2 text-center font-medium">{d.totalAudits}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`font-semibold ${d.completionRate >= 80 ? 'text-green-700' : d.completionRate >= 50 ? 'text-yellow-700' : 'text-red-700'}`}>
                        {d.completionRate}%
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`font-semibold ${d.discrepancyRate > 20 ? 'text-red-700' : d.discrepancyRate > 0 ? 'text-yellow-700' : 'text-green-700'}`}>
                        {d.discrepancyRate}%
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center text-gray-500">{d.totalSessions}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Scans per auditor */}
        <div className="card">
          <h4 className="font-medium text-gray-800 text-sm mb-3">Scans per Auditor (range total)</h4>
          {auditorList.length === 0 ? (
            <p className="text-gray-400 text-sm">No scan data for selected range.</p>
          ) : (
            <div className="space-y-2">
              {auditorList.map(([email, count]) => {
                const maxCount = auditorList[0][1];
                return (
                  <div key={email}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-sm text-gray-700 truncate max-w-[70%]">{email}</span>
                      <span className="text-sm font-semibold text-gray-900">{count}</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all"
                        style={{ width: `${Math.round((count / maxCount) * 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
