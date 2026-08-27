import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import TripsPage from "./pages/operations/Trips";
import DispatchPage from "./pages/operations/Dispatch";
import LiveTrackingPage from "./pages/operations/LiveTracking";
import ExceptionsPage from "./pages/operations/Exceptions";

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function PublicRoute({ children }) {
  const { user } = useAuth();
  if (user) return <Navigate to="/dashboard" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/operations"
        element={
          <ProtectedRoute>
            <Navigate to="/operations/trips" replace />
          </ProtectedRoute>
        }
      />
      <Route
        path="/operations/trips"
        element={
          <ProtectedRoute>
            <TripsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/operations/dispatch"
        element={
          <ProtectedRoute>
            <DispatchPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/operations/live-tracking"
        element={
          <ProtectedRoute>
            <LiveTrackingPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/operations/exceptions"
        element={
          <ProtectedRoute>
            <ExceptionsPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
