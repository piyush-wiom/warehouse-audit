import { useEffect, useState } from 'react';
import api from '../../lib/api';
import toast from 'react-hot-toast';
import { Plus, CheckSquare, Square, Users, Search, Trash2, UserPlus, X } from 'lucide-react';

const STATUS_BADGE = {
  Complete: 'badge-complete', Short: 'badge-short', Excess: 'badge-excess',
  Variance: 'badge-variance', Pending: 'badge-pending', Scanning: 'badge-scanning',
  Corrected: 'badge-corrected',
};

let _nextGroupId = 1;
function newGroup() { return { id: _nextGroupId++, auditor: '', bins: [] }; }

export default function Assignments() {
  const [assignments, setAssignments] = useState([]);
  const [statusMap, setStatusMap] = useState({});
  const [warehouses, setWarehouses] = useState([]);
  const [bins, setBins] = useState([]);           // all bins for selected warehouse
  const [auditors, setAuditors] = useState([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState('');
  const [groups, setGroups] = useState([newGroup()]); // multi-auditor groups
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  async function load() {
    const [a, w, u, r] = await Promise.allSettled([
      api.get('/assignments'),
      api.get('/inventory/warehouses'),
      api.get('/users'),
      api.get('/reconciliation'),
    ]);
    if (a.status === 'fulfilled') setAssignments(a.value.data);
    if (w.status === 'fulfilled') setWarehouses(w.value.data);
    if (u.status === 'fulfilled') setAuditors(u.value.data.filter(u => u.role === 'auditor' && u.isActive));
    if (r.status === 'fulfilled') {
      const map = {};
      for (const row of r.value.data) {
        const key = `${row.warehouse}::${row.bin}`;
        map[key] = { status: row.finalStatus, lpnBoxId: row.lpnBoxId || null };
      }
      setStatusMap(map);
    }
  }
  useEffect(() => { load(); }, []);

  async function handleWarehouseChange(warehouse) {
    setSelectedWarehouse(warehouse);
    setGroups([newGroup()]);
    if (warehouse) {
      const { data } = await api.get(`/inventory/bins/${warehouse}`);
      setBins(data);
    } else {
      setBins([]);
    }
  }

  // Bins already picked by OTHER groups (can't double-assign)
  function takenByOthers(groupId) {
    return new Set(groups.filter(g => g.id !== groupId).flatMap(g => g.bins));
  }

  function availableBins(groupId) {
    const taken = takenByOthers(groupId);
    return bins.filter(b => !b.isAssigned && !taken.has(b.binCode));
  }

  function toggleBin(groupId, binCode) {
    setGroups(prev => prev.map(g => {
      if (g.id !== groupId) return g;
      const bins = g.bins.includes(binCode)
        ? g.bins.filter(b => b !== binCode)
        : [...g.bins, binCode];
      return { ...g, bins };
    }));
  }

  function toggleAllForGroup(groupId) {
    const avail = availableBins(groupId).map(b => b.binCode);
    setGroups(prev => prev.map(g => {
      if (g.id !== groupId) return g;
      const allSelected = avail.length > 0 && avail.every(b => g.bins.includes(b));
      return { ...g, bins: allSelected ? [] : avail };
    }));
  }

  function addGroup() { setGroups(prev => [...prev, newGroup()]); }

  function removeGroup(id) {
    if (groups.length === 1) return; // keep at least one
    setGroups(prev => prev.filter(g => g.id !== id));
  }

  function updateAuditor(groupId, auditor) {
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, auditor } : g));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const validGroups = groups.filter(g => g.auditor && g.bins.length > 0);
    if (validGroups.length === 0) return toast.error('Add at least one auditor with bins selected');
    setSubmitting(true);
    let totalAssigned = 0, totalSkipped = 0;
    try {
      await Promise.all(validGroups.map(async g => {
        const { data } = await api.post('/assignments', {
          warehouse: selectedWarehouse,
          bin_codes: g.bins,
          assigned_to: g.auditor,
        });
        totalAssigned += data.assigned?.length || 0;
        totalSkipped  += data.skipped?.length  || 0;
      }));
      toast.success(`Assigned ${totalAssigned} bin(s) across ${validGroups.length} auditor(s)`);
      if (totalSkipped > 0) toast(`Skipped ${totalSkipped} already-assigned bin(s)`, { icon: '⚠️' });
      setGroups([newGroup()]);
      setSelectedWarehouse('');
      setBins([]);
      setShowForm(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Assignment failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUnassign(id, binCode) {
    if (!confirm(`Unassign bin ${binCode}?`)) return;
    try {
      await api.delete(`/assignments/${id}`);
      toast.success(`Unassigned ${binCode}`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to unassign');
    }
  }

  const [tableWarehouse, setTableWarehouse] = useState('');
  const [tableStatus, setTableStatus] = useState('');

  const filteredAssignments = assignments.filter(a => {
    if (userSearch && !a.assignedTo.toLowerCase().includes(userSearch.toLowerCase())) return false;
    if (tableWarehouse && a.warehouse !== tableWarehouse) return false;
    const status = (statusMap[`${a.warehouse}::${a.binCode}`]?.status) || 'Pending';
    if (tableStatus && status !== tableStatus) return false;
    return true;
  });

  const allWarehouses = [...new Set(assignments.map(a => a.warehouse))].sort();

  const summary = assignments.reduce((acc, a) => {
    const status = (statusMap[`${a.warehouse}::${a.binCode}`]?.status) || 'Pending';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  const totalBinsInForm = groups.reduce((s, g) => s + g.bins.length, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">Bin Assignments</h2>
        <button onClick={() => { setShowForm(v => !v); setGroups([newGroup()]); setSelectedWarehouse(''); setBins([]); }} className="btn-primary">
          <Plus size={16} /> Assign Bins
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="card mb-6 space-y-5">
          {/* Warehouse */}
          <div>
            <label className="label">Warehouse</label>
            <select className="input max-w-xs" value={selectedWarehouse} onChange={e => handleWarehouseChange(e.target.value)} required>
              <option value="">Select warehouse…</option>
              {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>

          {selectedWarehouse && bins.length > 0 && (
            <>
              {/* Auditor groups */}
              <div className="space-y-4">
                {groups.map((group, idx) => {
                  const avail = availableBins(group.id);
                  const allSelected = avail.length > 0 && avail.every(b => group.bins.includes(b));
                  return (
                    <div key={group.id} className="border border-gray-200 rounded-xl p-4 bg-gray-50">
                      <div className="flex items-center gap-3 mb-3">
                        <span className="text-sm font-semibold text-gray-600 shrink-0">Auditor {idx + 1}</span>
                        <select
                          className="input flex-1 max-w-xs"
                          value={group.auditor}
                          onChange={e => updateAuditor(group.id, e.target.value)}
                          required={group.bins.length > 0}
                        >
                          <option value="">Select auditor…</option>
                          {auditors.map(a => <option key={a.id} value={a.email}>{a.name} ({a.email})</option>)}
                        </select>
                        <span className="text-xs text-gray-500 shrink-0">{group.bins.length} bin(s) selected</span>
                        {groups.length > 1 && (
                          <button type="button" onClick={() => removeGroup(group.id)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors shrink-0">
                            <X size={15} />
                          </button>
                        )}
                      </div>

                      {/* Bin picker */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs text-gray-500">{avail.length} unassigned bin(s) available</span>
                          <button type="button" onClick={() => toggleAllForGroup(group.id)}
                            className="text-xs text-blue-600 hover:underline">
                            {allSelected ? 'Deselect All' : 'Select All'}
                          </button>
                        </div>
                        <div className="border border-gray-200 bg-white rounded-lg max-h-48 overflow-y-auto">
                          {avail.length === 0 ? (
                            <p className="text-xs text-gray-400 px-4 py-3 text-center">No unassigned bins remaining</p>
                          ) : (
                            avail.map(bin => (
                              <div
                                key={bin.binCode}
                                onClick={() => toggleBin(group.id, bin.binCode)}
                                className="flex items-center gap-3 px-4 py-2 border-b border-gray-100 last:border-0 hover:bg-blue-50 cursor-pointer"
                              >
                                {group.bins.includes(bin.binCode)
                                  ? <CheckSquare size={16} className="text-blue-600 shrink-0" />
                                  : <Square size={16} className="text-gray-400 shrink-0" />
                                }
                                <span className="font-mono text-sm font-medium">{bin.binCode}</span>
                                {bin.lpnBoxId && (
                                  <span className="text-xs bg-amber-50 border border-amber-200 text-amber-600 px-1.5 py-0.5 rounded font-mono">
                                    📦 {bin.lpnBoxId}
                                  </span>
                                )}
                                {bin.inventory && <span className="text-xs text-gray-400">{bin.inventory}</span>}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Add another auditor */}
              <button type="button" onClick={addGroup}
                className="flex items-center gap-2 text-sm text-blue-600 hover:underline font-medium">
                <UserPlus size={15} /> Add another auditor
              </button>

              {/* Submit */}
              <div className="flex gap-3 pt-2 border-t border-gray-100">
                <button type="submit" className="btn-primary" disabled={submitting || totalBinsInForm === 0}>
                  {submitting ? 'Assigning…' : `Assign ${totalBinsInForm > 0 ? `(${totalBinsInForm} bins, ${groups.filter(g => g.auditor && g.bins.length).length} auditors)` : ''}`}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              </div>
            </>
          )}
        </form>
      )}

      {/* Summary stats */}
      {assignments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <span className="text-xs text-gray-500 self-center mr-1">Progress:</span>
          {Object.entries(summary).map(([status, count]) => (
            <button
              key={status}
              onClick={() => setTableStatus(s => s === status ? '' : status)}
              className={`${STATUS_BADGE[status] || 'badge-pending'} cursor-pointer ${tableStatus === status ? 'ring-2 ring-offset-1 ring-blue-400' : ''}`}
            >
              {status}: {count}
            </button>
          ))}
          <span className="text-xs text-gray-400 self-center ml-1">Total: {assignments.length} assigned</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Search size={16} className="text-gray-400 shrink-0" />
        <input className="input max-w-[200px]" placeholder="Filter by auditor…"
          value={userSearch} onChange={e => setUserSearch(e.target.value)} />
        <select className="input w-auto" value={tableWarehouse} onChange={e => setTableWarehouse(e.target.value)}>
          <option value="">All Warehouses</option>
          {allWarehouses.map(w => <option key={w} value={w}>{w}</option>)}
        </select>
        <select className="input w-auto" value={tableStatus} onChange={e => setTableStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {['Pending', 'Scanning', 'Complete', 'Short', 'Excess', 'Variance', 'Corrected'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {(userSearch || tableWarehouse || tableStatus) && (
          <button onClick={() => { setUserSearch(''); setTableWarehouse(''); setTableStatus(''); }}
            className="text-sm text-blue-600 hover:underline">Clear filters</button>
        )}
        <span className="text-xs text-gray-400 ml-auto">{filteredAssignments.length} of {assignments.length} bins</span>
      </div>

      {/* Table */}
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['Warehouse', 'Bin', 'LPN/Box ID', 'Status', 'Assigned To', 'Assigned By', 'Assigned Date', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredAssignments.map(a => {
              const binInfo = statusMap[`${a.warehouse}::${a.binCode}`] || {};
              const status = binInfo.status || 'Pending';
              const lpnBoxId = binInfo.lpnBoxId || null;
              return (
                <tr key={a.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{a.warehouse}</td>
                  <td className="px-4 py-3 font-mono text-sm">{a.binCode}</td>
                  <td className="px-4 py-3">
                    {lpnBoxId
                      ? <span className="text-xs bg-amber-50 border border-amber-200 text-amber-700 px-2 py-0.5 rounded font-mono">📦 {lpnBoxId}</span>
                      : <span className="text-xs text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3"><span className={STATUS_BADGE[status] || 'badge-pending'}>{status}</span></td>
                  <td className="px-4 py-3 text-gray-600">{a.assignedTo}</td>
                  <td className="px-4 py-3 text-gray-500">{a.assignedBy}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{new Date(a.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                  <td className="px-4 py-3">
                    {status === 'Pending' ? (
                      <button onClick={() => handleUnassign(a.id, a.binCode)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Unassign bin">
                        <Trash2 size={14} />
                      </button>
                    ) : (
                      <span className="text-xs text-gray-300 px-1.5" title="Cannot unassign — audit already started">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filteredAssignments.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                {(userSearch || tableWarehouse || tableStatus) ? 'No assignments match the selected filters' : 'No assignments yet'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
