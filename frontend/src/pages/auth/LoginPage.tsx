import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDaysIcon, EyeIcon, EyeOffIcon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { ApiRequestError } from '@/lib/api';

export function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Already logged in — redirect
  if (user) {
    const dest = user.roles.includes('ADMIN') ? '/admin'
      : user.roles.includes('FACULTY') ? '/faculty'
      : '/student';
    navigate(dest, { replace: true });
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(identifier.trim(), password);
      // AuthContext sets user; router handles redirect via RoleRedirect
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.error.message);
      } else {
        setError('Login failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-brand-600 rounded-2xl mb-4 shadow-lg">
            <CalendarDaysIcon className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Slotify</h1>
          <p className="text-sm text-gray-500 mt-1">Smart Campus Timetable Management</p>
        </div>

        {/* Card */}
        <div className="card p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-5">Sign in to your account</h2>

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label" htmlFor="identifier">Email or Username</label>
              <input
                id="identifier"
                type="text"
                className="input"
                placeholder="Enter your email or username"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                autoComplete="username"
                required
                disabled={loading}
              />
            </div>

            <div>
              <label className="label" htmlFor="password">Password</label>
              <div className="relative">
                <input
                  id="password"
                  type={showPw ? 'text' : 'password'}
                  className="input pr-10"
                  placeholder="Enter your password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  disabled={loading}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPw(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPw ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Signing in…
                </span>
              ) : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Contact your administrator if you need access.
        </p>
      </div>
    </div>
  );
}
