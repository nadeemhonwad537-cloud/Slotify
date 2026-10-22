import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LayoutDashboardIcon, CalendarDaysIcon, BookOpenIcon, LogOutIcon, MenuIcon } from 'lucide-react';

const nav = [
  { to: '/student',           label: 'Dashboard',         icon: LayoutDashboardIcon, end: true },
  { to: '/student/timetable', label: 'My Timetable',      icon: CalendarDaysIcon },
  { to: '/student/subjects',  label: 'Subjects & Courses', icon: BookOpenIcon },
];

export function StudentShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  async function handleLogout() { await logout(); navigate('/login'); }

  const sidebar = (
    <aside className="flex flex-col h-full bg-white border-r border-gray-200 w-64">
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center">
            <CalendarDaysIcon className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">Slotify</p>
            <p className="text-xs text-purple-600 font-medium">Student Portal</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} onClick={() => setOpen(false)}
            className={({ isActive }) => isActive ? 'nav-item-active' : 'nav-item-inactive'}>
            <Icon className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1 text-sm">{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="px-3 py-3 border-t border-gray-100">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg">
          <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center text-purple-700 text-xs font-semibold">
            {user?.name?.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{user?.name}</p>
            <p className="text-xs text-gray-400">Student</p>
          </div>
          <button onClick={handleLogout} className="btn-ghost p-1.5" title="Logout">
            <LogOutIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <div className="hidden lg:flex">{sidebar}</div>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative flex">{sidebar}</div>
        </div>
      )}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200">
          <button onClick={() => setOpen(true)} className="btn-ghost p-1.5"><MenuIcon className="w-5 h-5" /></button>
          <span className="text-sm font-semibold text-gray-900">Slotify Student</span>
        </div>
        <main className="flex-1 overflow-y-auto p-6"><Outlet /></main>
      </div>
    </div>
  );
}
