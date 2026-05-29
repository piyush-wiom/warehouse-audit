import { useEffect, useState } from 'react';
import api from '../../lib/api';
import { Users, Package, ClipboardList, Activity } from 'lucide-react';

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

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);

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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
    </div>
  );
}
