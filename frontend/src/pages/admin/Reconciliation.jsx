import { useEffect, useState } from 'react';
import api from '../../lib/api';
import { Download, Filter } from 'lucide-react';

const STATUS_BADGE = {
  Complete: 'badge-complete',
  Short: 'badge-short',
  Excess: 'badge-excess',
  Variance: 'badge-variance',
  Pending: 'badge-pending',
  Scanning: 'badge-scanning',
  Corrected: 'badge-corrected',
};

export default function Reconciliation() {
  const [rows, setRows] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [filters, setFilters] = useState({ warehouse: '', status: '' });
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const params = {};
      if (filters.warehouse) params.warehouse = filters.warehouse;
      if (filters.status) params.status = filters.status;
      const { data } = await api.get('/reconciliation', { params });
      setRows(data);
      const ws = [...new Set(data.map(r => r.warehouse))];
      setWarehouses(ws);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [filters]);

  async function handleExport() {
    const params = new URLSearchParams();
    if (filters.warehouse) params.set('warehouse', filters.warehouse);
    if (filters.status) params.set('status', filters.status);
    window.open(`/api/reconciliation/export?${params}`, '_blank');
  }

  const summary = rows.reduce((acc, r) => {
    acc[r.finalStatus] = (acc[r.finalStatus] || 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">Reconciliation</h2>
        <button onClick={handleExport} className="btn-secondary">
          <Download size={16} /> Export CSV
        </button>
      </div>

      {/* Summary pills */}
      <div className="flex flex-wrap gap-2 mb-4">
        {Object.entries(summary).map(([status, count]) => (
          <button
            key={status}
            onClick={() => setFilters(f => ({ ...f, status: f.status === status ? '' : status }))}
            className={`${STATUS_BADGE[status] || 'badge-pending'} cursor-pointer ${filters.status === status ? 'ring-2 ring-offset-1 ring-blue-400' : ''}`}
          >
            {status}: {count}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="card mb-4 flex flex-wrap gap-3 items-center p-4">
        <Filter size={16} className="text-gray-400" />
        <select
          className="input w-auto"
          value={filters.warehouse}
          onChange={e => setFilters(f => ({ ...f, warehouse: e.target.value }))}
        >
          <option value="">All Warehouses</option>
          {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
        </select>
        <select
          className="input w-auto"
          value={filters.status}
          onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
        >
          <option value="">All Statuses</option>
          {['Complete', 'Short', 'Excess', 'Variance', 'Pending', 'Scanning', 'Corrected'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {(filters.warehouse || filters.status) && (
          <button onClick={() => setFilters({ warehouse: '', status: '' })} className="text-sm text-blue-600 hover:underline">
            Clear filters
          </button>
        )}
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['Warehouse', 'Bin', 'Expected', 'Matched', 'Variance', 'Remaining', 'Scanned', 'Status', 'Re-audit Var', 'Auditor', 'Correction'].map(h => (
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-3 py-2.5 font-medium whitespace-nowrap">{r.warehouse}</td>
                <td className="px-3 py-2.5 font-mono text-xs">{r.bin}</td>
                <td className="px-3 py-2.5 text-center">{r.expected}</td>
                <td className="px-3 py-2.5 text-center text-green-700 font-medium">{r.matched}</td>
                <td className="px-3 py-2.5 text-center text-red-700 font-medium">{r.variance}</td>
                <td className="px-3 py-2.5 text-center">{r.remaining}</td>
                <td className="px-3 py-2.5 text-center">{r.totalScanned}</td>
                <td className="px-3 py-2.5">
                  <span className={STATUS_BADGE[r.finalStatus] || 'badge-pending'}>{r.finalStatus}</span>
                </td>
                <td className="px-3 py-2.5 text-center">{r.reauditVariance ?? '—'}</td>
                <td className="px-3 py-2.5 text-gray-500 text-xs truncate max-w-[120px]">{r.auditor || '—'}</td>
                <td className="px-3 py-2.5 text-gray-500 text-xs max-w-[160px] truncate">
                  {r.correction ? r.correction.remark : '—'}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">No data. Upload inventory first.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
