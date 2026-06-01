import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import AdminDashboard from './pages/admin/AdminDashboard';
import Users from './pages/admin/Users';
import Inventory from './pages/admin/Inventory';
import Assignments from './pages/admin/Assignments';
import Reconciliation from './pages/admin/Reconciliation';
import Corrections from './pages/admin/Corrections';
import InventoryViewer from './pages/admin/InventoryViewer';
import AuditorDashboard from './pages/auditor/AuditorDashboard';
import ScanBin from './pages/auditor/ScanBin';
import ReauditBins from './pages/auditor/ReauditBins';

function AdminLayout({ children }) {
  return (
    <ProtectedRoute role="admin">
      <Layout>{children}</Layout>
    </ProtectedRoute>
  );
}
function AuditorLayout({ children }) {
  return (
    <ProtectedRoute role="auditor">
      <Layout>{children}</Layout>
    </ProtectedRoute>
  );
}

export default function App() {
  const { user } = useAuthStore();

  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* Admin routes */}
      <Route path="/admin" element={<AdminLayout><AdminDashboard /></AdminLayout>} />
      <Route path="/admin/users" element={<AdminLayout><Users /></AdminLayout>} />
      <Route path="/admin/inventory" element={<AdminLayout><Inventory /></AdminLayout>} />
      <Route path="/admin/inventory-view" element={<AdminLayout><InventoryViewer /></AdminLayout>} />
      <Route path="/admin/assignments" element={<AdminLayout><Assignments /></AdminLayout>} />
      <Route path="/admin/reconciliation" element={<AdminLayout><Reconciliation /></AdminLayout>} />
      <Route path="/admin/corrections" element={<AdminLayout><Corrections /></AdminLayout>} />

      {/* Auditor routes */}
      <Route path="/auditor" element={<AuditorLayout><AuditorDashboard /></AuditorLayout>} />
      <Route path="/auditor/scan/:warehouse/:binCode" element={<AuditorLayout><ScanBin /></AuditorLayout>} />
      <Route path="/auditor/reaudit" element={<AuditorLayout><ReauditBins /></AuditorLayout>} />

      {/* Root redirect */}
      <Route
        path="/"
        element={
          user ? (
            <Navigate to={user.role === 'admin' ? '/admin' : '/auditor'} replace />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
