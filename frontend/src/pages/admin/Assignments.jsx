import { useEffect, useState } from 'react';
import api from '../../lib/api';
import toast from 'react-hot-toast';
import { Plus, CheckSquare, Square, Users } from 'lucide-react';

export default function Assignments() {
  const [assignments, setAssignments] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [bins, setBins] = useState([]);
  const [auditors, setAuditors] = useState([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState('');
  const [selectedAuditor, setSelectedAuditor] = useState('');
  const [selectedBins, setSelectedBins] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);

  async function load() {
    const [a, w, u] = await Promise.allSettled([
      api.get('/assignments'),
      api.get('/inventory/warehouses'),
      api.get('/users'),
    ]);
    if (a.status === 'fulfilled') setAssignments(a.value.data);
    if (w.status === 'fulfilled') setWarehouses(w.value.data);
    if (u.status === 'fulfilled') setAuditors(u.value.data.filter(u => u.role === 'auditor' && u.isActive));
  }
  useEffect(() => { load(); }, []);

  async function handleWarehouseChange(warehouse) {
    setSelectedWarehouse(warehouse);
    setSelectedBins([]);
    if (warehouse) {
      const { data } = await api.get(`/inventory/bins/${warehouse}`);
      setBins(data);
    } else {
      setBins([]);
    }
  }

  function toggleBin(binCode) {
    setSelectedBins(prev =>
      prev.includes(binCode) ? prev.filter(b => b !== binCode) : [...prev, binCode]
    );
  }

  function toggleAll() {
    const unassigned = bins.filter(b => !b.isAssigned).map(b => b.binCode);
    if (selectedBins.length === unassigned.length) {
      setSelectedBins([]);
    } else {
      setSelectedBins(unassigned);
    }
  }

  async function handleAssign(e) {
    e.preventDefault();
    if (selectedBins.length === 0) return toast.error('Select at least one bin');
    if (!selectedAuditor) return toast.error('Select an auditor');
    setLoading(true);
    try {
      const { data } = await api.post('/assignments', {
        warehouse: selectedWarehouse,
        bin_codes: selectedBins,
        assigned_to: selectedAuditor,
      });
      toast.success(data.message);
      if (data.skipped?.length) {
        toast(`Skipped already assigned: ${data.skipped.join(', ')}`, { icon: '⚠️' });
      }
      setSelectedBins([]);
      setSelectedAuditor('');
      setShowForm(false);
      load();
      handleWarehouseChange(selectedWarehouse); // refresh bins
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed');
    } finally {
      setLoading(false);
    }
  }

  const unassignedBins = bins.filter(b => !b.isAssigned);
  const allSelected = unassignedBins.length > 0 && selectedBins.length === unassignedBins.length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">Bin Assignments</h2>
        <button onClick={() => setShowForm(v => !v)} className="btn-primary">
          <Plus size={16} /> Assign Bins
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAssign} className="card mb-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Warehouse</label>
              <select className="input" value={selectedWarehouse} onChange={e => handleWarehouseChange(e.target.value)} required>
                <option value="">Select warehouse…</option>
                {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Assign to Auditor</label>
              <select className="input" value={selectedAuditor} onChange={e => setSelectedAuditor(e.target.value)} required>
                <option value="">Select auditor…</option>
                {auditors.map(a => <option key={a.id} value={a.email}>{a.name} ({a.email})</option>)}
              </select>
            </div>
          </div>

          {selectedWarehouse && bins.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="label mb-0">Select Bins ({selectedBins.length} selected)</label>
                <button type="button" onClick={toggleAll} className="text-sm text-blue-600 hover:underline">
                  {allSelected ? 'Deselect All' : `Select All Unassigned (${unassignedBins.length})`}
                </button>
              </div>
              <div className="border border-gray-200 rounded-lg max-h-64 overflow-y-auto">
                {bins.map(bin => (
                  <div
                    key={bin.binCode}
                    onClick={() => !bin.isAssigned && toggleBin(bin.binCode)}
                    className={`flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 last:border-0 ${
                      bin.isAssigned
                        ? 'bg-gray-50 cursor-not-allowed opacity-60'
                        : 'hover:bg-blue-50 cursor-pointer'
                    }`}
                  >
                    {bin.isAssigned ? (
                      <CheckSquare size={18} className="text-gray-400 shrink-0" />
                    ) : selectedBins.includes(bin.binCode) ? (
                      <CheckSquare size={18} className="text-blue-600 shrink-0" />
                    ) : (
                      <Square size={18} className="text-gray-400 shrink-0" />
                    )}
                    <span className="font-mono text-sm font-medium">{bin.binCode}</span>
                    <span className="text-xs text-gray-500">{bin.inventory}</span>
                    {bin.isAssigned && (
                      <span className="ml-auto text-xs text-gray-400 flex items-center gap-1">
                        <Users size={12} /> {bin.assignedTo}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button type="submit" className="btn-primary" disabled={loading || selectedBins.length === 0}>
              {loading ? 'Assigning…' : `Assign ${selectedBins.length > 0 ? `(${selectedBins.length} bins)` : ''}`}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
          </div>
        </form>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['Warehouse', 'Bin', 'Assigned To', 'Assigned By', 'Date'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {assignments.map(a => (
              <tr key={a.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{a.warehouse}</td>
                <td className="px-4 py-3 font-mono text-sm">{a.binCode}</td>
                <td className="px-4 py-3 text-gray-600">{a.assignedTo}</td>
                <td className="px-4 py-3 text-gray-500">{a.assignedBy}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">{new Date(a.createdAt).toLocaleDateString('en-IN')}</td>
              </tr>
            ))}
            {assignments.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No assignments yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
