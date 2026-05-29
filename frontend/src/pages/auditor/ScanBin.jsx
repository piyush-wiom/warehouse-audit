import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import toast from 'react-hot-toast';
import { ArrowLeft, CheckCircle, AlertTriangle, Info, StopCircle } from 'lucide-react';

const SCAN_COLORS = {
  matched: 'bg-green-50 border-green-200 text-green-800',
  variance: 'bg-red-50 border-red-200 text-red-800',
  already_scanned: 'bg-yellow-50 border-yellow-200 text-yellow-800',
};
const SCAN_ICONS = {
  matched: CheckCircle,
  variance: AlertTriangle,
  already_scanned: Info,
};

export default function ScanBin() {
  const { warehouse, binCode } = useParams();
  const navigate = useNavigate();
  const inputRef = useRef();

  const [session, setSession] = useState(null);
  const [stats, setStats] = useState({ expected: 0, matched: 0, variance: 0, remaining: 0, totalScanned: 0, status: 'Pending' });
  const [scanLog, setScanLog] = useState([]);
  const [scanInput, setScanInput] = useState('');
  const [scanType, setScanType] = useState('Auto');
  const [ending, setEnding] = useState(false);

  // Start or resume session on mount
  useEffect(() => {
    async function init() {
      try {
        // Check for existing open session for this warehouse
        const { data: mySessions } = await api.get('/sessions/my');
        const existing = mySessions.find(s => s.warehouse === decodeURIComponent(warehouse) && !s.endTime);

        let sess;
        if (existing) {
          sess = existing;
          toast('Resuming existing session', { icon: 'ℹ️' });
        } else {
          const { data } = await api.post('/sessions/start', { warehouse: decodeURIComponent(warehouse) });
          sess = data.session;
          toast.success('Session started');
        }
        setSession(sess);
        await refreshStats(sess.id);
      } catch (err) {
        toast.error('Could not start session');
        console.error(err);
      }
    }
    init();
  }, [warehouse]);

  // Auto-focus scan input
  useEffect(() => { inputRef.current?.focus(); }, [session]);

  async function refreshStats(sessionId) {
    try {
      const { data } = await api.get(`/sessions/${sessionId || session?.id}/bin-stats/${decodeURIComponent(binCode)}`);
      setStats(data);
      setScanLog(data.scans || []);
    } catch { }
  }

  async function handleScan(e) {
    e.preventDefault();
    if (!scanInput.trim() || !session) return;

    const rawInput = scanInput.trim();
    setScanInput('');
    inputRef.current?.focus();

    try {
      const { data } = await api.post(`/sessions/${session.id}/scan`, {
        bin_code: decodeURIComponent(binCode),
        raw_input: rawInput,
        scan_type: scanType === 'Auto' ? undefined : scanType,
      });

      setScanLog(prev => [{ ...data.scan, status: data.status, message: data.message, id: Date.now() }, ...prev]);
      await refreshStats(session.id);

      if (data.status === 'matched') toast.success(data.message, { duration: 2000 });
      else if (data.status === 'variance') toast.error(data.message, { duration: 3000 });
      else toast(data.message, { icon: '⚠️', duration: 3000 });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Scan failed');
    }
  }

  async function handleEndSession() {
    if (!confirm('End session and finalize this bin?')) return;
    setEnding(true);
    try {
      await api.post(`/sessions/${session.id}/end`);
      toast.success('Session ended');
      navigate('/auditor');
    } catch {
      toast.error('Failed to end session');
    } finally {
      setEnding(false);
    }
  }

  const statusColor = {
    Complete: 'bg-green-500',
    Short: 'bg-yellow-500',
    Excess: 'bg-orange-500',
    Variance: 'bg-red-500',
    Pending: 'bg-gray-400',
    Scanning: 'bg-blue-500',
  }[stats.status] || 'bg-gray-400';

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/auditor')} className="btn-secondary p-2">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-gray-900">{decodeURIComponent(binCode)}</h2>
          <p className="text-sm text-gray-500">{decodeURIComponent(warehouse)}</p>
        </div>
        <button onClick={handleEndSession} disabled={ending} className="btn-danger">
          <StopCircle size={16} /> {ending ? 'Ending…' : 'End Session'}
        </button>
      </div>

      {/* Stats bar */}
      <div className="card mb-4 p-4">
        <div className="flex items-center justify-between mb-3">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold text-white ${statusColor}`}>
            <span className="w-2 h-2 rounded-full bg-white/70 animate-pulse" />
            {stats.status}
          </span>
          <span className="text-sm text-gray-500">Session: {session?.id?.slice(-8) || '…'}</span>
        </div>
        <div className="grid grid-cols-4 gap-3 text-center">
          {[
            { label: 'Expected', value: stats.expected, cls: 'text-gray-900' },
            { label: 'Matched', value: stats.matched, cls: 'text-green-700' },
            { label: 'Variance', value: stats.variance, cls: 'text-red-700' },
            { label: 'Remaining', value: stats.remaining, cls: 'text-blue-700' },
          ].map(({ label, value, cls }) => (
            <div key={label}>
              <div className={`text-2xl font-bold ${cls}`}>{value}</div>
              <div className="text-xs text-gray-500">{label}</div>
            </div>
          ))}
        </div>
        {/* Progress bar */}
        <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 transition-all duration-300"
            style={{ width: stats.expected ? `${Math.min(100, (stats.matched / stats.expected) * 100)}%` : '0%' }}
          />
        </div>
      </div>

      {/* Scan input */}
      <div className="card mb-4 p-4">
        <div className="flex gap-2 mb-3">
          <label className="text-sm font-medium text-gray-700 self-center shrink-0">Scan type:</label>
          {['Auto', 'Manual'].map(t => (
            <button
              key={t}
              onClick={() => setScanType(t)}
              className={`px-3 py-1 text-sm rounded-lg border transition-colors ${scanType === t ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
            >
              {t}
            </button>
          ))}
        </div>
        <form onSubmit={handleScan} className="flex gap-2">
          <input
            ref={inputRef}
            className="input flex-1 font-mono text-base"
            placeholder={scanType === 'Manual' ? 'Type serial number…' : 'Scan barcode or QR code here…'}
            value={scanInput}
            onChange={e => setScanInput(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
          />
          <button type="submit" className="btn-primary shrink-0" disabled={!scanInput.trim()}>
            Scan
          </button>
        </form>
        <p className="text-xs text-gray-400 mt-2">Scanner acts as keyboard — point scanner at device and trigger</p>
      </div>

      {/* Scan log */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {scanLog.map((entry, i) => {
          const status = entry.status || (entry.matched ? 'matched' : 'variance');
          const Icon = SCAN_ICONS[status] || Info;
          return (
            <div key={entry.id || i} className={`flex items-start gap-2 p-3 rounded-lg border text-sm ${SCAN_COLORS[status] || ''}`}>
              <Icon size={16} className="mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{entry.extractedSerial || entry.rawInput || 'Unknown'}</p>
                {entry.message && <p className="text-xs mt-0.5 opacity-75 truncate">{entry.message}</p>}
              </div>
              <span className="text-xs opacity-60 shrink-0">{entry.scanType || ''}</span>
            </div>
          );
        })}
        {scanLog.length === 0 && (
          <div className="text-center py-8 text-gray-400">
            <p>No scans yet. Start scanning devices in this bin.</p>
          </div>
        )}
      </div>
    </div>
  );
}
