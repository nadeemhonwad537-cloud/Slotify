import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingScreen } from '@/components/ui/LoadingScreen';

// Auth
import { LoginPage } from '@/pages/auth/LoginPage';

// Admin
import { AdminShell } from '@/components/layout/AdminShell';
import { AdminDashboard } from '@/pages/admin/DashboardPage';
import { UsersPage } from '@/pages/admin/UsersPage';
import { DepartmentsPage } from '@/pages/admin/DepartmentsPage';
import { AcademicStructurePage } from '@/pages/admin/AcademicStructurePage';
import { CoursesPage } from '@/pages/admin/CoursesPage';
import { FacultyPage } from '@/pages/admin/FacultyPage';
import { RoomsPage } from '@/pages/admin/RoomsPage';
import { SubmissionsPage } from '@/pages/admin/SubmissionsPage';
import { AssignmentsPage } from '@/pages/admin/AssignmentsPage';
import { ValidationPage } from '@/pages/admin/ValidationPage';
import { TimetableVersionsPage } from '@/pages/admin/TimetableVersionsPage';
import { WorkloadImportPage } from '@/pages/admin/WorkloadImportPage';

// Faculty
import { FacultyShell } from '@/components/layout/FacultyShell';
import { FacultyDashboard } from '@/pages/faculty/DashboardPage';
import { PreferencesPage } from '@/pages/faculty/PreferencesPage';
import { AvailabilityPage } from '@/pages/faculty/AvailabilityPage';
import { AssignedSubjectsPage } from '@/pages/faculty/AssignedSubjectsPage';
import { WorkloadPage } from '@/pages/faculty/WorkloadPage';
import { FacultyTimetablePage } from '@/pages/faculty/TimetablePage';
import { FacultyProfilePage } from '@/pages/faculty/ProfilePage';
import { TrackPage } from '@/pages/faculty/TrackPage';

// Student
import { StudentShell } from '@/components/layout/StudentShell';
import { StudentDashboard } from '@/pages/student/DashboardPage';
import { StudentTimetablePage } from '@/pages/student/TimetablePage';
import { StudentSubjectsPage } from '@/pages/student/SubjectsPage';

function RequireAuth({ children, role }: { children: React.ReactNode; role?: 'ADMIN' | 'FACULTY' | 'STUDENT' }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (role && !user.roles.includes(role)) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RoleRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.roles.includes('ADMIN')) return <Navigate to="/admin" replace />;
  if (user.roles.includes('FACULTY')) return <Navigate to="/faculty" replace />;
  if (user.roles.includes('STUDENT')) return <Navigate to="/student" replace />;
  return <Navigate to="/login" replace />;
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<RoleRedirect />} />

      {/* Admin routes */}
      <Route path="/admin" element={<RequireAuth role="ADMIN"><AdminShell /></RequireAuth>}>
        <Route index element={<AdminDashboard />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="departments" element={<DepartmentsPage />} />
        <Route path="academic-structure" element={<AcademicStructurePage />} />
        <Route path="courses" element={<CoursesPage />} />
        <Route path="faculty" element={<FacultyPage />} />
        <Route path="workload-imports" element={<WorkloadImportPage />} />
        <Route path="rooms" element={<RoomsPage />} />
        <Route path="submissions" element={<SubmissionsPage />} />
        <Route path="assignments" element={<AssignmentsPage />} />
        <Route path="validation" element={<ValidationPage />} />
        <Route path="timetable-versions" element={<TimetableVersionsPage />} />
      </Route>

      {/* Faculty routes */}
      <Route path="/faculty" element={<RequireAuth role="FACULTY"><FacultyShell /></RequireAuth>}>
        <Route index element={<FacultyDashboard />} />
        <Route path="preferences" element={<PreferencesPage />} />
        <Route path="availability" element={<AvailabilityPage />} />
        <Route path="subjects" element={<AssignedSubjectsPage />} />
        <Route path="workload" element={<WorkloadPage />} />
        <Route path="timetable" element={<FacultyTimetablePage />} />
        <Route path="profile" element={<FacultyProfilePage />} />
        <Route path="track" element={<TrackPage />} />
      </Route>

      {/* Student routes */}
      <Route path="/student" element={<RequireAuth role="STUDENT"><StudentShell /></RequireAuth>}>
        <Route index element={<StudentDashboard />} />
        <Route path="timetable" element={<StudentTimetablePage />} />
        <Route path="subjects" element={<StudentSubjectsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
