import { useEffect, useState } from 'react';
import api from '../../lib/api';
import { Search, Filter, Package } from 'lucide-react';

export default function InventoryViewer() {
  const [warehouses, setWarehouses] = useState([]);
  const [bins, setBins] = useState([]);
  const [devices, setDevices] = useState([]);
  const [uploadInfo, setUploadInfo] = useState(null);
  const [filters, setFilters] = useState({ warehouse: '', bin: '', search: '' });
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    api.get('/inventory/warehouses').then(r => setWarehouses(r.data)).catch(() => {});
    api.get('/inventory/upload-info').then(r => setUploadInfo(r.data)).catch(() => {});
  }, []);

  async function handleWarehouseChange(warehouse) {
    setFilters(f => ({ ...f, warehouse, bin: '' }));
    setDevices([]);
    if (warehouse) {
      const { data } = await api.get(`/inventory/bins/${warehouse}`);
      setBins(data);
    } else {
      setBins([]);
    }
  }

  async function handleSearch() {
    if (!filters.warehouse) return;
    setLoading(true);
    try {
      const params = { warehouse: filters.warehouse };
      if (filters.bin) params.bin = filters.bin;
      if (filters.search) params.search = filters.search;
      const { data } = await api.get('/inventory/devices-view', { params });
      setDevices(data.devices);
      setTotal(data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (filters.warehouse) handleSearch();
  }, [filters.warehouse, filters.bin]);

  const filtered = filters.search
    ? devices.filter(d =>
        [d.serialNo, d.macId, d.deviceId, d.description, d.no2]
          .some(v => v && v.toLowerCase().includes(filters.search.toLowerCase()))
      )
    : devices;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Inventory Data</h2>
          {uploadInfo && (
            <p className="text-sm text-gray-500 mt-0.5">
              Last uploaded: <strong>{uploadInfo.filename}</strong> on{' '}
              {new Date(uploadInfo.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              {' '}by {uploadInfo.uploadedBy}
            </p>
          )}
        </div>
        {total > 0 && (
          <span className="badge-complete text-sm px-3 py-1">
            <Package size={14} className="inline mr-1" />
            {filtered.length} of {total} devices
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="card mb-4 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="label">Warehouse</label>
            <select className="input" value={filters.warehouse} onChange={e => handleWarehouseChange(e.target.value)}>
              <option value="">Select warehouse…</option>
              {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Bin (optional)</label>
            <select className="input" value={filters.bin} onChange={e => setFilters(f => ({ ...f, bin: e.target.value }))}>
              <option value="">All bins</option>
              {bins.map(b => <option key={b.binCode} value={b.binCode}>{b.binCode}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Search Serial / MAC / Device ID</label>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="input pl-9"
                placeholder="Search…"
                value={filters.search}
                onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      {!filters.warehouse ? (
        <div className="card text-center py-16">
          <Package size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">Select a warehouse to view inventory</p>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['#', 'Bin', 'Zone', 'Serial No', 'Mac ID', 'Device ID', 'Type', 'Description', 'Inventory'].map(h => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
              ) : filtered.map((d, i) => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-400 text-xs">{i + 1}</td>
                  <td className="px-3 py-2 font-mono text-xs font-medium">{d.binCode}</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{d.zoneCode || '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{d.serialNo || '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{d.macId || '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{d.deviceId || '—'}</td>
                  <td className="px-3 py-2 text-xs">{d.no2 || '—'}</td>
                  <td className="px-3 py-2 text-xs text-gray-600 max-w-[200px] truncate">{d.description || '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex px-2 py-0.5 text-xs rounded-full font-medium ${
                      d.inventory === 'Good Inventory' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {d.inventory || '—'}
                    </span>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">No devices found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
