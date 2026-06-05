import { useEffect, useState } from 'react';
import api from '../../lib/api';
import toast from 'react-hot-toast';
import { Download, Filter, Calendar, X, CheckCircle, AlertTriangle, Search } from 'lucide-react';

const STATUS_BADGE = {
  Complete: 'badge-complete', Short: 'badge-short', Excess: 'badge-excess',
  Variance: 'badge-variance', Pending: 'badge-pending', Scanning: 'badge-scanning',
  Corrected: 'badge-corrected',
};

function DateInput({ label, value, onChange }) {
  return (
    <div className="flex items-center gap-1">
      <label className="text-xs text-gray-500 whitespace-nowrap">{label}</label>
      <input type="date" className="input py-1 text-sm" value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

// Bin Drill-down Modal
function BinDetailModal({ warehouse, binCode, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/reconciliation/bin-detail/${encodeURIComponent(warehouse)}/${encodeURIComponent(binCode)}`)
      .then(r => setDetail(r.data))
      .catch(() => toast.error('Failed to load bin detail'))
      .finally(() => setLoading(false));
  }, [warehouse, binCode]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h3 className="font-bold text-gray-900 text-lg">{binCode}</h3>
            <p className="text-sm text-gray-500">{warehouse}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-12 text-gray-400">Loading…</div>
        ) : detail ? (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {/* Summary bar */}
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-2xl font-bold text-gray-900">{detail.expected}</p>
                <p className="text-xs text-gray-500 mt-0.5">Expected</p>
              </div>
              <div className="bg-green-50 rounded-xl p-3">
                <p className="text-2xl font-bold text-green-700">{detail.matched.length}</p>
                <p className="text-xs text-green-600 mt-0.5">Matched</p>
              </div>
              <div className={`rounded-xl p-3 ${detail.missing.length > 0 || detail.variance.length > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
                <p className={`text-2xl font-bold ${detail.missing.length > 0 || detail.variance.length > 0 ? 'text-red-700' : 'text-gray-400'}`}>
                  {detail.missing.length + detail.variance.length}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">Issues</p>
              </div>
            </div>

            {/* Missing devices */}
            {detail.missing.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-red-700 mb-2 flex items-center gap-1.5">
                  <AlertTriangle size={14} /> Missing ({detail.missing.length}) — in inventory, never scanned
                </p>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {detail.missing.map((inv, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-100 text-sm">
                      <span className="font-mono text-red-800 flex-1">{inv.serialNo || '—'}</span>
                      {inv.no2 && <span className="text-xs text-red-500 shrink-0">{inv.no2}</span>}
                      {inv.description && <span className="text-xs text-gray-400 truncate max-w-[160px]">{inv.description}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Variance devices */}
            {detail.variance.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-orange-700 mb-2 flex items-center gap-1.5">
                  <AlertTriangle size={14} /> Variance ({detail.variance.length}) — scanned but not in inventory
                </p>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {detail.variance.map((scan, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-50 border border-orange-100 text-sm">
                      <span className="font-mono text-orange-800 flex-1">{scan.extractedSerial || scan.rawInput || '—'}</span>
                      <span className="text-xs text-gray-400 shrink-0">{scan.auditorEmail}</span>
                      <span className="text-xs text-gray-300 shrink-0">{new Date(scan.scannedAt).toLocaleDateString('en-IN')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Matched devices */}
            {detail.matched.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-green-700 mb-2 flex items-center gap-1.5">
                  <CheckCircle size={14} /> Matched ({detail.matched.length})
                </p>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {detail.matched.map((scan, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 border border-green-100 text-sm">
                      <span className="font-mono text-green-800 flex-1">{scan.serialNo || scan.extractedSerial || '—'}</span>
                      {scan.deviceType && <span className="text-xs text-green-500 shrink-0">{scan.deviceType}</span>}
                      <span className="text-xs text-gray-400 shrink-0">{scan.auditorEmail}</span>
                      <span className="text-xs text-gray-300 shrink-0">{new Date(scan.scannedAt).toLocaleDateString('en-IN')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detail.missing.length === 0 && detail.variance.length === 0 && (
              <div className="text-center py-6">
                <CheckCircle size={40} className="mx-auto text-green-400 mb-2" />
                <p className="text-green-700 font-medium">All devices matched correctly</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center py-12 text-gray-400">No data found</div>
        )}
      </div>
    </div>
  );
}

export default function Reconciliation() {
  const [rows, setRows] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [filters, setFilters] = useState({ warehouse: '', status: '', date_from: '', date_to: '' });
  const [loading, setLoading] = useState(true);
  const [selectedBin, setSelectedBin] = useState(null); // { warehouse, binCode }

  // Default: last 3 months
  useEffect(() => {
    const today = new Date();
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(today.getMonth() - 3);
    setFilters(f => ({
      ...f,
      date_from: threeMonthsAgo.toISOString().slice(0, 10),
      date_to: today.toISOString().slice(0, 10),
    }));
  }, []);

  async function load() {
    setLoading(true);
    try {
      const params = {};
      if (filters.warehouse) params.warehouse = filters.warehouse;
      if (filters.status) params.status = filters.status;
      if (filters.date_from) params.date_from = filters.date_from;
      if (filters.date_to) params.date_to = filters.date_to;
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

  useEffect(() => {
    if (filters.date_from || filters.date_to || true) load();
  }, [filters]);

  async function handleDetailedExport() {
    try {
      const params = {};
      if (filters.warehouse) params.warehouse = filters.warehouse;
      if (filters.status) params.status = filters.status;
      if (filters.date_from) params.date_from = filters.date_from;
      if (filters.date_to) params.date_to = filters.date_to;
      toast.loading('Generating detailed report…', { id: 'export' });
      const { data } = await api.get('/reconciliation/export-detailed', { params, responseType: 'blob' });
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const url = URL.createObjectURL(new Blob([data], { type: 'text/csv' }));
      const a = document.createElement('a'); a.href = url;
      a.download = `reconciliation_detailed_${today}.csv`; a.click();
      URL.revokeObjectURL(url);
      toast.success('Detailed report downloaded', { id: 'export' });
    } catch { toast.error('Export failed', { id: 'export' }); }
  }

  async function handleExport() {
    try {
      const params = {};
      if (filters.warehouse) params.warehouse = filters.warehouse;
      if (filters.status) params.status = filters.status;
      if (filters.date_from) params.date_from = filters.date_from;
      if (filters.date_to) params.date_to = filters.date_to;
      const { data } = await api.get('/reconciliation/export', { params, responseType: 'blob' });
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const url = URL.createObjectURL(new Blob([data], { type: 'text/csv' }));
      const a = document.createElement('a'); a.href = url;
      a.download = `reconciliation_${today}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Export failed'); }
  }

  const summary = rows.reduce((acc, r) => {
    acc[r.finalStatus] = (acc[r.finalStatus] || 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      {selectedBin && (
        <BinDetailModal
          warehouse={selectedBin.warehouse}
          binCode={selectedBin.binCode}
          onClose={() => setSelectedBin(null)}
        />
      )}

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-900">Reconciliation</h2>
        <div className="flex gap-2">
          <button onClick={handleExport} className="btn-secondary">
            <Download size={16} /> Summary CSV
          </button>
          <button onClick={handleDetailedExport} className="btn-primary">
            <Download size={16} /> Device-Level CSV
          </button>
        </div>
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
      <div className="card mb-4 p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <Filter size={16} className="text-gray-400 shrink-0" />
          <select className="input w-auto" value={filters.warehouse}
            onChange={e => setFilters(f => ({ ...f, warehouse: e.target.value }))}>
            <option value="">All Warehouses</option>
            {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
          <select className="input w-auto" value={filters.status}
            onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
            <option value="">All Statuses</option>
            {['Complete', 'Short', 'Excess', 'Variance', 'Pending', 'Scanning', 'Corrected'].map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <div className="flex items-center gap-2 flex-wrap">
            <Calendar size={14} className="text-gray-400" />
            <DateInput label="From" value={filters.date_from} onChange={v => setFilters(f => ({ ...f, date_from: v }))} />
            <DateInput label="To" value={filters.date_to} onChange={v => setFilters(f => ({ ...f, date_to: v }))} />
          </div>
          {(filters.warehouse || filters.status || filters.date_from || filters.date_to) && (
            <button onClick={() => {
              const today = new Date().toISOString().slice(0, 10);
              const ago = new Date(); ago.setMonth(ago.getMonth() - 3);
              setFilters({ warehouse: '', status: '', date_from: ago.toISOString().slice(0, 10), date_to: today });
            }} className="text-sm text-blue-600 hover:underline">Reset filters</button>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
          <Calendar size={11} /> Showing audit data for selected date range · Click any row to see device-level detail
        </p>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['Warehouse', 'Bin', 'Audit Date', 'Expected', 'Matched', 'Variance', 'Remaining', 'Scanned', 'Status', 'Auditor', 'Correction'].map(h => (
                <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
            ) : rows.map((r, i) => (
              <tr
                key={i}
                className="hover:bg-blue-50 cursor-pointer transition-colors"
                onClick={() => setSelectedBin({ warehouse: r.warehouse, binCode: r.bin })}
                title="Click to see device-level detail"
              >
                <td className="px-3 py-2.5 font-medium whitespace-nowrap">{r.warehouse}</td>
                <td className="px-3 py-2.5 font-mono text-xs font-semibold text-blue-700">{r.bin}</td>
                <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                  {r.sessionDate ? new Date(r.sessionDate).toLocaleDateString('en-IN') : '—'}
                </td>
                <td className="px-3 py-2.5 text-center">{r.expected}</td>
                <td className="px-3 py-2.5 text-center text-green-700 font-medium">{r.matched}</td>
                <td className="px-3 py-2.5 text-center text-red-700 font-medium">{r.variance}</td>
                <td className="px-3 py-2.5 text-center">{r.remaining}</td>
                <td className="px-3 py-2.5 text-center">{r.totalScanned}</td>
                <td className="px-3 py-2.5">
                  <span className={STATUS_BADGE[r.finalStatus] || 'badge-pending'}>{r.finalStatus}</span>
                </td>
                <td className="px-3 py-2.5 text-gray-500 text-xs truncate max-w-[120px]">{r.auditor || '—'}</td>
                <td className="px-3 py-2.5 text-gray-500 text-xs max-w-[160px] truncate">
                  {r.correction ? r.correction.remark : '—'}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">No data for selected filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
