import { useState, useRef } from 'react';
import api from '../../lib/api';
import toast from 'react-hot-toast';
import { Upload, FileText, AlertTriangle, CheckCircle, Download, Trash2 } from 'lucide-react';

const SAMPLE_CSV = `LocationCode,ItemNo,No2,Description,Inventory,BinCode,ZoneCode,SerialNo,MacId,DeviceId,LpnBoxId
WH-DELHI,ITEM001,ONT,Optical Network Terminal,Good Inventory,BIN-A01,ZONE-01,SY104766,AA:BB:CC:DD:EE:01,DEV001,LPN-001
WH-DELHI,ITEM002,Router,WiFi Router,Good Inventory,BIN-A01,ZONE-01,SY104767,AA:BB:CC:DD:EE:02,DEV002,LPN-001
WH-DELHI,ITEM003,ONT,Optical Network Terminal,Bad Inventory,BIN-B01,ZONE-02,SY104768,AA:BB:CC:DD:EE:03,DEV003,LPN-002
`;

function downloadSampleCSV() {
  const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'inventory_template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function Inventory() {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [resetting, setResetting] = useState(false);
  const fileRef = useRef();

  async function handleUpload(e) {
    e.preventDefault();
    const file = fileRef.current?.files[0];
    if (!file) return toast.error('Select a file first');

    const fd = new FormData();
    fd.append('file', file);
    setUploading(true);
    setResult(null);

    try {
      const { data } = await api.post('/inventory/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult({ type: 'success', ...data });
      toast.success(data.message);
      if (data.cleanup) toast(data.cleanup, { icon: '🧹', duration: 5000 });
      fileRef.current.value = '';
    } catch (err) {
      const msg = err.response?.data?.error || 'Upload failed';
      setResult({ type: 'error', message: msg });
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  }

  async function handleResetAll() {
    if (!confirm('⚠️ This will permanently delete ALL audit data — inventory, sessions, scans, assignments, corrections. Are you sure?')) return;
    if (!confirm('Final confirmation: Delete everything and start fresh?')) return;
    setResetting(true);
    try {
      await api.delete('/inventory/reset-all');
      toast.success('All data cleared. Upload new inventory to begin.', { duration: 6000 });
      setResult(null);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Reset failed');
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">Inventory Upload</h2>
        <button
          onClick={handleResetAll}
          disabled={resetting}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
        >
          <Trash2 size={14} />
          {resetting ? 'Clearing…' : 'Clear All Data'}
        </button>
      </div>

      <div className="card mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900">Required Columns</h3>
          <button onClick={downloadSampleCSV} className="btn-secondary text-xs py-1.5">
            <Download size={14} /> Download Template
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
          {['LocationCode', 'ItemNo', 'No2', 'Description', 'Inventory', 'BinCode', 'ZoneCode', 'SerialNo', 'MacId', 'DeviceId'].map(col => (
            <code key={col} className="text-xs bg-gray-100 px-2 py-1 rounded font-mono">{col}</code>
          ))}
        </div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-gray-500 font-medium">Optional:</span>
          <code className="text-xs bg-blue-50 border border-blue-200 px-2 py-1 rounded font-mono text-blue-700">LpnBoxId</code>
          <span className="text-xs text-gray-400">Physical box / pallet label on the rack</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Accepted formats: <strong>.csv</strong> or <strong>.xlsx</strong> · Each upload replaces existing inventory.
        </p>
        <p className="text-xs text-gray-500 mt-1">
          <strong>Inventory</strong> column: <code>Good Inventory</code> or <code>Bad Inventory</code>
        </p>
      </div>

      <div className="card">
        <form onSubmit={handleUpload} className="space-y-4">
          <div
            className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-blue-400 transition-colors cursor-pointer"
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={32} className="mx-auto text-gray-400 mb-2" />
            <p className="text-sm text-gray-600">Click to select file or drag & drop</p>
            <p className="text-xs text-gray-400 mt-1">CSV or Excel (.xlsx)</p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={() => {}}
            />
          </div>

          {fileRef.current?.files?.[0] && (
            <div className="flex items-center gap-2 text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded-lg">
              <FileText size={16} />
              {fileRef.current.files[0].name}
            </div>
          )}

          <button type="submit" className="btn-primary w-full justify-center" disabled={uploading}>
            {uploading ? 'Uploading…' : 'Upload Inventory'}
          </button>
        </form>

        {result && (
          <div className={`mt-4 p-4 rounded-lg ${result.type === 'success' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
            <div className="flex items-start gap-2">
              {result.type === 'success'
                ? <CheckCircle size={18} className="text-green-600 mt-0.5 shrink-0" />
                : <AlertTriangle size={18} className="text-red-600 mt-0.5 shrink-0" />}
              <div>
                <p className={`text-sm font-medium ${result.type === 'success' ? 'text-green-800' : 'text-red-800'}`}>
                  {result.message}
                </p>
                {result.warnings?.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {result.warnings.map((w, i) => (
                      <li key={i} className="text-xs text-yellow-700 flex items-center gap-1">
                        <AlertTriangle size={12} /> {w}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
