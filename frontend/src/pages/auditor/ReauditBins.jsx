import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { ScanLine, ChevronRight } from 'lucide-react';

export default function ReauditBins() {
  const [bins, setBins] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await api.get('/corrections/reaudit/my');
      setBins(data);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <p className="text-gray-400">Loading…</p>;

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-6">Re-audit Assignments</h2>

      {bins.length === 0 ? (
        <div className="card text-center py-12">
          <ScanLine size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">No re-audit bins assigned.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bins.map(b => (
            <Link
              key={b.id}
              to={`/auditor/scan/${encodeURIComponent(b.warehouse)}/${encodeURIComponent(b.binCode)}`}
              className="card flex items-center justify-between hover:shadow-md transition-shadow cursor-pointer"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-gray-900">{b.warehouse}</span>
                  <span className="text-gray-400">›</span>
                  <span className="font-mono font-semibold">{b.binCode}</span>
                  <span className="badge-variance">Re-audit</span>
                </div>
                {b.varianceSerials?.length > 0 && (
                  <p className="text-xs text-red-700 mt-1">
                    Variance: {b.varianceSerials.slice(0, 3).join(', ')}{b.varianceSerials.length > 3 ? ` +${b.varianceSerials.length - 3} more` : ''}
                  </p>
                )}
                {b.missingSerials?.length > 0 && (
                  <p className="text-xs text-yellow-700 mt-0.5">
                    Missing: {b.missingSerials.slice(0, 3).join(', ')}{b.missingSerials.length > 3 ? ` +${b.missingSerials.length - 3} more` : ''}
                  </p>
                )}
              </div>
              <ChevronRight size={20} className="text-gray-400 shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
