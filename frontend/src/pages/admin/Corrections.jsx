import { useEffect, useState } from 'react';
import api from '../../lib/api';
import toast from 'react-hot-toast';
import { CheckCircle, RotateCcw } from 'lucide-react';

export default function Corrections() {
  const [flagged, setFlagged] = useState([]);
  const [auditors, setAuditors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [remarkMap, setRemarkMap] = useState({});
  const [reauditMap, setReauditMap] = useState({});

  async function load() {
    setLoading(true);
    try {
      const [f, u] = await Promise.all([api.get('/corrections/flagged'), api.get('/users')]);
      setFlagged(f.data);
      setAuditors(u.data.filter(u => u.role === 'auditor' && u.isActive));
    } catch { }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

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
      <h2 className="text-xl font-bold text-gray-900 mb-6">Corrections & Re-audit</h2>

      {loading ? (
        <p className="text-gray-400">Loading…</p>
      ) : flagged.length === 0 ? (
        <div className="card text-center py-12">
          <CheckCircle size={48} className="mx-auto text-green-400 mb-3" />
          <p className="text-gray-600 font-medium">No flagged bins</p>
          <p className="text-gray-400 text-sm">All audited bins are complete.</p>
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
                  {/* Mark corrected */}
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

                  {/* Assign re-audit */}
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
