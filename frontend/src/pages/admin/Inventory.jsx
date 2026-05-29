import { useState, useRef } from 'react';
import api from '../../lib/api';
import toast from 'react-hot-toast';
import { Upload, FileText, AlertTriangle, CheckCircle } from 'lucide-react';

export default function Inventory() {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
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
      fileRef.current.value = '';
    } catch (err) {
      const msg = err.response?.data?.error || 'Upload failed';
      setResult({ type: 'error', message: msg });
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-xl font-bold text-gray-900 mb-6">Inventory Upload</h2>

      <div className="card mb-6">
        <h3 className="font-semibold text-gray-900 mb-3">Required Columns (exact names)</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {['LocationCode', 'ItemNo', 'No2', 'Description', 'Inventory', 'BinCode', 'ZoneCode', 'SerialNo', 'MacId', 'DeviceId'].map(col => (
            <code key={col} className="text-xs bg-gray-100 px-2 py-1 rounded font-mono">{col}</code>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-3">
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
