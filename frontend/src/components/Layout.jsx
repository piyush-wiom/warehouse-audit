import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import api from '../lib/api';
import toast from 'react-hot-toast';
import {
  LayoutDashboard, Users, Upload, ClipboardList,
  BarChart2, CheckSquare, LogOut, Menu, X, ScanLine, Package,
} from 'lucide-react';
import { useState } from 'react';

const adminNav = [
  { to: '/admin', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/admin/users', icon: Users, label: 'Users' },
  { to: '/admin/inventory', icon: Upload, label: 'Inventory' },
  { to: '/admin/inventory-view', icon: Package, label: 'View Inventory' },
  { to: '/admin/assignments', icon: ClipboardList, label: 'Assignments' },
  { to: '/admin/reconciliation', icon: BarChart2, label: 'Reconciliation' },
  { to: '/admin/corrections', icon: CheckSquare, label: 'Corrections' },
];

const auditorNav = [
  { to: '/auditor', icon: LayoutDashboard, label: 'My Bins' },
  { to: '/auditor/reaudit', icon: ScanLine, label: 'Re-audit' },
];

export default function Layout({ children }) {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const nav = user?.role === 'admin' ? adminNav : auditorNav;

  async function handleLogout() {
    try { await api.post('/auth/logout'); } catch {}
    logout();
    navigate('/login');
    toast.success('Logged out');
  }

  const NavLinks = () => (
    <>
      {nav.map(({ to, icon: Icon, label }) => {
        const active = location.pathname === to;
        return (
          <Link
            key={to}
            to={to}
            onClick={() => setMobileOpen(false)}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              active ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            }`}
          >
            <Icon size={18} />
            {label}
          </Link>
        );
      })}
    </>
  );

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar — desktop */}
      <aside className="hidden md:flex flex-col w-56 bg-white border-r border-gray-200 p-4">
        <div className="mb-8">
          <h1 className="text-lg font-bold text-gray-900">Warehouse Audit</h1>
          <p className="text-xs text-gray-500 mt-0.5 capitalize">{user?.role} · {user?.name}</p>
        </div>
        <nav className="flex-1 space-y-1">
          <NavLinks />
        </nav>
        <button onClick={handleLogout} className="flex items-center gap-3 px-3 py-2 text-sm text-gray-600 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors">
          <LogOut size={18} /> Logout
        </button>
      </aside>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <h1 className="font-bold text-gray-900">Warehouse Audit</h1>
        <button onClick={() => setMobileOpen(v => !v)}>
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-20 bg-black/40" onClick={() => setMobileOpen(false)}>
          <aside className="w-64 h-full bg-white p-4 flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="mb-6 mt-2">
              <p className="text-sm font-medium text-gray-900">{user?.name}</p>
              <p className="text-xs text-gray-500 capitalize">{user?.role}</p>
            </div>
            <nav className="flex-1 space-y-1"><NavLinks /></nav>
            <button onClick={handleLogout} className="flex items-center gap-3 px-3 py-2 text-sm text-gray-600 hover:text-red-600">
              <LogOut size={18} /> Logout
            </button>
          </aside>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-auto md:pt-0 pt-14">
        <div className="max-w-7xl mx-auto p-6">{children}</div>
      </main>
    </div>
  );
}
