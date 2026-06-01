import { useEffect, useState } from 'react';
import api from '../../lib/api';
import toast from 'react-hot-toast';
import { CheckCircle, RotateCcw, Filter, Calendar } from 'lucide-react';

export default function Corrections() {
  const [flagged, setFlagged] = useState([]);
  const [auditors, setAuditors] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [remarkMap, setRemarkMap] = useState({});
  const [reauditMap, setReauditMap] = useState({});
  const [filters, setFilters] = useState({
    warehouse: '',
    date_from: new Date().toISOString().slice(0, 10), // default: today
    date_to: new Date().toISOString().slice(0, 10),
  });

  async function load() {
    setLoading(true);
    try {
      const params = {};
      if (filters.warehouse) params.warehouse = filters.warehouse;
      if (filters.date_from) params.date_from = filters.date_from;
      if (filters.date_to) params.date_to = filters.date_to;

      const [f, u, w] = await Promise.all([
        api.get('/corrections/flagged', { params }),
        api.get('/users'),
        api.get('/inventory/warehouses'),
      ]);
      setFlagged(f.data);
      setAuditors(u.data.filter(u => u.role === 'auditor' && u.isActive));
      setWarehouses(w.data);
    } catch { }
    setLoading(false);
  }

  useEffect(() => { load(); }, [filters]);

  async function handleCorrect(warehouse, binCode) {
    const remark = remarkMap[`${warehouse}::${binCode}`];
    if (!remark?.trim()) return toast.error('Enter a remark first');
    try {
      await api.post('/corrections', { warehouse, bin_code: binCode, remark });
      toast.success('Correction recorded');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed');
    }
  }

  async function handleReaudit(warehouse, binCode) {
    const assigned_to = reauditMap[`${warehouse}::${binCode}`];
    if (!assigned_to) return toast.error('Select an auditor');
    try {
      await api.post('/corrections/reaudit/assign', { warehouse, bin_code: binCode, assigned_to });
      toast.success('Re-audit assigned');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed');
    }
  }

  const STATUS_BADGE = { Short: 'badge-short', Excess: 'badge-excess', Variance: 'badge-variance' };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-900">Corrections & Re-audit</h2>
        <span className="text-sm text-gray-500">{flagged.length} flagged bin{flagged.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Filters */}
      <div className="card mb-4 p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <Filter size={16} className="text-gray-400 shrink-0" />

          <select
            className="input w-auto"
            value={filters.warehouse}
            onChange={e => setFilters(f => ({ ...f, warehouse: e.target.value }))}
          >
            <option value="">All Warehouses</option>
            {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
          </select>

          <div className="flex items-center gap-2 flex-wrap">
            <Calendar size={14} className="text-gray-400" />
            <div className="flex items-center gap-1">
              <label className="text-xs text-gray-500">From</label>
              <input
                type="date"
                className="input py-1 text-sm"
                value={filters.date_from}
                onChange={e => setFilters(f => ({ ...f, date_from: e.target.value }))}
              />
            </div>
            <div className="flex items-center gap-1">
              <label className="text-xs text-gray-500">To</label>
              <input
                type="date"
                className="input py-1 text-sm"
                value={filters.date_to}
                onChange={e => setFilters(f => ({ ...f, date_to: e.target.value }))}
              />
            </div>
          </div>

          <button
            onClick={() => setFilters({
              warehouse: '',
              date_from: new Date().toISOString().slice(0, 10),
              date_to: new Date().toISOString().slice(0, 10),
            })}
            className="text-sm text-blue-600 hover:underline"
          >
            Reset to today
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Showing corrections for audit sessions within the selected date range
        </p>
      </div>

      {loading ? (
        <p className="text-gray-400">Loading…</p>
      ) : flagged.length === 0 ? (
        <div className="card text-center py-12">
          <CheckCircle size={48} className="mx-auto text-green-400 mb-3" />
          <p className="text-gray-600 font-medium">No flagged bins</p>
          <p className="text-gray-400 text-sm">No Short / Excess / Variance bins for the selected date range.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {flagged.map(bin => {
            const key = `${bin.warehouse}::${bin.bin}`;
            return (
              <div key={key} className="card">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-gray-900">{bin.warehouse}</span>
                      <span className="text-gray-400">›</span>
                      <span className="font-mono text-sm">{bin.bin}</span>
                      <span className={STATUS_BADGE[bin.status] || 'badge-pending'}>{bin.status}</span>
                    </div>
                    <p className="text-sm text-gray-500">
                      Expected: {bin.expected} · Matched: {bin.matched} · Variance: {bin.variance} · Auditor: {bin.auditor}
                    </p>
                  </div>
                  {bin.correction && (
                    <span className="badge-corrected">Corrected: {bin.correction.remark}</span>
                  )}
                </div>

                {bin.varianceSerials?.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs font-medium text-red-700 mb-1">Variance serials (scanned but not in inventory):</p>
                    <div className="flex flex-wrap gap-1">
                      {bin.varianceSerials.map(s => (
                        <code key={s} className="text-xs bg-red-50 border border-red-200 px-2 py-0.5 rounded">{s}</code>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-gray-100">
                  <div className="flex gap-2">
                    <input
                      className="input flex-1"
                      placeholder="Correction remark…"
                      value={remarkMap[key] || ''}
                      onChange={e => setRemarkMap(m => ({ ...m, [key]: e.target.value }))}
                    />
                    <button onClick={() => handleCorrect(bin.warehouse, bin.bin)} className="btn-success shrink-0">
                      <CheckCircle size={16} /> Mark Corrected
                    </button>
                  </div>

                  <div className="flex gap-2">
                    <select
                      className="input flex-1"
                      value={reauditMap[key] || ''}
                      onChange={e => setReauditMap(m => ({ ...m, [key]: e.target.value }))}
                    >
                      <option value="">Assign re-audit to…</option>
                      {auditors.map(a => <option key={a.id} value={a.email}>{a.name}</option>)}
                    </select>
                    <button onClick={() => handleReaudit(bin.warehouse, bin.bin)} className="btn-secondary shrink-0">
                      <RotateCcw size={16} /> Assign
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
