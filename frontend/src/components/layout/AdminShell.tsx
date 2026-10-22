import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  LayoutDashboardIcon, UsersIcon, BuildingIcon, GraduationCapIcon,
  BookOpenIcon, UsersRoundIcon, DoorOpenIcon, ClipboardListIcon,
  UserCheckIcon, ShieldCheckIcon, CalendarDaysIcon, LogOutIcon,
  MenuIcon, XIcon, ChevronRightIcon,
  FileSearchIcon,
} from 'lucide-react';

const nav = [
  { to: '/admin',                  label: 'Dashboard',                icon: LayoutDashboardIcon, end: true },
  { to: '/admin/users',            label: 'Manage Users',             icon: UsersIcon },
  { to: '/admin/departments',      label: 'Departments',              icon: BuildingIcon },
  { to: '/admin/academic-structure', label: 'Academic Structure',     icon: GraduationCapIcon },
  { to: '/admin/courses',          label: 'Courses & Curriculum',     icon: BookOpenIcon },
  { to: '/admin/faculty',          label: 'Faculty & Workload',       icon: UsersRoundIcon },
  { to: '/admin/workload-imports', label: 'Workload Import Review',   icon: FileSearchIcon },
  { to: '/admin/rooms',            label: 'Rooms & Settings',         icon: DoorOpenIcon },
  { to: '/admin/submissions',      label: 'Faculty Preferences',      icon: ClipboardListIcon },
  { to: '/admin/assignments',      label: 'Assign Faculty',           icon: UserCheckIcon },
  { to: '/admin/validation',       label: 'Validation & Conflicts',   icon: ShieldCheckIcon },
  { to: '/admin/timetable-versions', label: 'Timetable Versions',    icon: CalendarDaysIcon },
];

export function AdminShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  const sidebar = (
    <aside className="flex flex-col h-full bg-white border-r border-gray-200 w-64">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center">
            <CalendarDaysIcon className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">Slotify</p>
            <p className="text-xs text-brand-600 font-medium">Admin Portal</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setOpen(false)}
            className={({ isActive }) => isActive ? 'nav-item-active' : 'nav-item-inactive'}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1 text-sm">{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
      <div className="px-3 py-3 border-t border-gray-100">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg">
          <div className="w-8 h-8 bg-brand-100 rounded-full flex items-center justify-center text-brand-700 text-xs font-semibold">
            {user?.name?.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{user?.name}</p>
            <p className="text-xs text-gray-400 truncate">{user?.username}</p>
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
      {/* Desktop sidebar */}
      <div className="hidden lg:flex">{sidebar}</div>

      {/* Mobile sidebar overlay */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative flex">{sidebar}</div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile header */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200">
          <button onClick={() => setOpen(true)} className="btn-ghost p-1.5">
            <MenuIcon className="w-5 h-5" />
          </button>
          <span className="text-sm font-semibold text-gray-900">Slotify Admin</span>
        </div>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
