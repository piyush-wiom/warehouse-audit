import { useEffect, useState } from 'react';
import api from '../../lib/api';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';

export default function Assignments() {
  const [assignments, setAssignments] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [bins, setBins] = useState([]);
  const [auditors, setAuditors] = useState([]);
  const [form, setForm] = useState({ warehouse: '', bin_code: '', assigned_to: '' });
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
    setForm(f => ({ ...f, warehouse, bin_code: '' }));
    if (warehouse) {
      const { data } = await api.get(`/inventory/bins/${warehouse}`);
      setBins(data);
    } else {
      setBins([]);
    }
  }

  async function handleAssign(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/assignments', form);
      toast.success('Bin assigned');
      setForm({ warehouse: '', bin_code: '', assigned_to: '' });
      setShowForm(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">Bin Assignments</h2>
        <button onClick={() => setShowForm(v => !v)} className="btn-primary">
          <Plus size={16} /> Assign Bin
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAssign} className="card mb-6 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label className="label">Warehouse</label>
            <select className="input" value={form.warehouse} onChange={e => handleWarehouseChange(e.target.value)} required>
              <option value="">Select…</option>
              {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Bin</label>
            <select className="input" value={form.bin_code} onChange={e => setForm(f => ({ ...f, bin_code: e.target.value }))} required>
              <option value="">Select…</option>
              {bins.map(b => <option key={b.binCode} value={b.binCode}>{b.binCode} ({b.inventory})</option>)}
            </select>
          </div>
          <div>
            <label className="label">Auditor</label>
            <select className="input" value={form.assigned_to} onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))} required>
              <option value="">Select…</option>
              {auditors.map(a => <option key={a.id} value={a.email}>{a.name} ({a.email})</option>)}
            </select>
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Assigning…' : 'Assign'}
          </button>
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
                <td className="px-4 py-3 text-gray-400 text-xs">{new Date(a.createdAt).toLocaleDateString()}</td>
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
