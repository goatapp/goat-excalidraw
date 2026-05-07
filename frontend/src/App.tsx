import { Suspense, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { UploadProvider } from './context/UploadContext';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Loader2 } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { lazyWithRetry } from './utils/lazyWithRetry';
import { useVersionCheck } from './hooks/useVersionCheck';

const Dashboard = lazyWithRetry(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Editor = lazyWithRetry(() => import('./pages/Editor').then(m => ({ default: m.Editor })));
const Settings = lazyWithRetry(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const Profile = lazyWithRetry(() => import('./pages/Profile').then(m => ({ default: m.Profile })));
const Admin = lazyWithRetry(() => import('./pages/Admin').then(m => ({ default: m.Admin })));
const Login = lazyWithRetry(() => import('./pages/Login').then(m => ({ default: m.Login })));
const Register = lazyWithRetry(() => import('./pages/Register').then(m => ({ default: m.Register })));
const PasswordResetRequest = lazyWithRetry(() => import('./pages/PasswordResetRequest').then(m => ({ default: m.PasswordResetRequest })));
const PasswordResetConfirm = lazyWithRetry(() => import('./pages/PasswordResetConfirm').then(m => ({ default: m.PasswordResetConfirm })));
const AuthSetupChoice = lazyWithRetry(() => import('./pages/AuthSetupChoice').then(m => ({ default: m.AuthSetupChoice })));

const PageLoader = () => (
  <div className="min-h-screen bg-slate-50 dark:bg-neutral-950 flex items-center justify-center">
    <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
  </div>
);

function App() {
  useVersionCheck(() => {
    toast('A new version is available.', {
      id: 'version-update',
      duration: Infinity,
      action: {
        label: 'Reload',
        onClick: () => window.location.reload(),
      },
    });
  });

  useEffect(() => {
    const handler = () => {
      toast.error('A new version has been deployed. Please reload the page.', {
        id: 'chunk-error',
        duration: Infinity,
        action: {
          label: 'Reload',
          onClick: () => window.location.reload(),
        },
      });
    };
    window.addEventListener('chunk-load-error', handler);
    return () => window.removeEventListener('chunk-load-error', handler);
  }, []);

  return (
    <ThemeProvider>
      <Router>
        <AuthProvider>
          <UploadProvider>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/reset-password" element={<PasswordResetRequest />} />
                <Route path="/reset-password-confirm" element={<PasswordResetConfirm />} />
                <Route path="/auth-setup" element={<AuthSetupChoice />} />
                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <Dashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/collections"
                  element={
                    <ProtectedRoute>
                      <Dashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <ProtectedRoute>
                      <Settings />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/profile"
                  element={
                    <ProtectedRoute>
                      <Profile />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute>
                      <Admin />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/editor/:id"
                  element={
                    <ProtectedRoute>
                      <Editor />
                    </ProtectedRoute>
                  }
                />
                <Route path="/shared/:id" element={<Editor />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </UploadProvider>
        </AuthProvider>
      </Router>
      <Toaster position="top-center" />
    </ThemeProvider>
  );
}

export default App;
