/**
 * Faculty Preference and Availability Form — 4-step wizard
 *
 * Step 1: Faculty profile review (read-only identity)
 * Step 2: Subject browser — search, filter, select exactly 3 preferences
 * Step 3: Availability windows (AVAILABLE / UNAVAILABLE / UNKNOWN)
 * Step 4: Review summary + Save Draft / Submit
 *
 * After submission, shows status and locks the form. Returned forms reopen
 * with reviewer feedback. Preferences are requests — never automatic assignments.
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useFacultyProfile } from '@/hooks/useFacultyProfile';
import { api, listRequest } from '@/lib/api';
import { facultySubmissionEditorState } from '@/lib/facultySubmissionEditor';
import { FacultyProfileStatus } from '@/components/faculty/FacultyProfileStatus';
import { FacultyTermContextSelector } from '@/components/faculty/FacultyTermContextSelector';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { ErrorMessage, FormError } from '@/components/ui/ErrorMessage';
import {
  UserIcon, BookOpenIcon, ClockIcon, CheckCircleIcon,
  AlertTriangleIcon, PlusIcon, Trash2Icon, ArrowRightIcon, ArrowLeftIcon,
  SendIcon, SaveIcon, ChevronUpIcon, ChevronDownIcon, InfoIcon,
  SearchIcon, FilterIcon, XIcon, BuildingIcon, GraduationCapIcon,
} from 'lucide-react';
import type {
  AcademicYear, FacultyProfile, Designation, Department, Term,
  SubmissionDetail, AvailableCourse, AvailabilityType,
} from '@/types';
import { activeFacultyTerms, activeFacultyYears, filterFacultyTerms, initialFacultyTerm } from '@/lib/facultyAcademicContext';

// ─── Constants ────────────────────────────────────────────────────────────────
const REQUIRED_PREFS = 3;
const EMPTY_AVAILABLE_COURSES: AvailableCourse[] = [];
interface CurriculumChoice {
  program_id: number;
  program_code: string;
  program_name: string;
  scheme_id: number;
  semester_id: number;
  semester_no: number;
  semester_name: string | null;
}
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
const AV_TYPES: AvailabilityType[] = ['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN'];
const avColor: Record<AvailabilityType, 'green' | 'red' | 'yellow'> = {
  AVAILABLE: 'green', UNAVAILABLE: 'red', UNKNOWN: 'yellow',
};
const avLabel: Record<AvailabilityType, string> = {
  AVAILABLE: 'Available', UNAVAILABLE: 'Unavailable', UNKNOWN: 'Unknown / Not sure',
};
const STEP_LABELS = ['Profile', 'Preferences', 'Availability', 'Review & Submit'];
const compColor: Record<string, 'blue' | 'green' | 'yellow' | 'purple'> = {
  THEORY: 'blue', LAB: 'green', TUTORIAL: 'yellow', PROJECT: 'purple',
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface PrefRow {
  kind: 'COURSE' | 'SOURCE';
  course_id: string;
  component_id: string;
  note: string;
  source_row_id?: string;
  source_subject_column?: string;
  source_label?: string;
  source_page?: number;
  source_row_number?: number;
  source_hours?: number | null;
  // display fields (populated when selected)
  course_name?: string;
  course_code?: string | null;
  component_type?: string | null;
  weekly_hours?: number | null;
}
interface AvWindow { day: string; start_time: string; end_time: string; availability_type: AvailabilityType }

// ─── Step indicator ───────────────────────────────────────────────────────────
function StepBar({ step, locked }: { step: number; locked: boolean }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const done = step > n;
        const active = step === n;
        return (
          <div key={n} className="flex items-center flex-1">
            <div className="flex flex-col items-center gap-1 flex-shrink-0">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors
                ${done ? 'bg-brand-600 border-brand-600 text-white' : active ? 'bg-white border-brand-600 text-brand-600' : 'bg-white border-gray-300 text-gray-400'}`}>
                {done ? <CheckCircleIcon className="w-4 h-4" /> : n}
              </div>
              <span className={`text-xs font-medium hidden sm:block ${active ? 'text-brand-600' : done ? 'text-brand-500' : 'text-gray-400'}`}>{label}</span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 ${done ? 'bg-brand-600' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
      {locked && (
        <div className="ml-4 flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">
          <AlertTriangleIcon className="w-3 h-3" /> Locked
        </div>
      )}
    </div>
  );
}

// ─── Step 1: Profile ──────────────────────────────────────────────────────────
function Step1Profile({
  profile, designations, departments, term, canContinue, onNext,
}: {
  profile: FacultyProfile | null | undefined;
  designations: Designation[]; departments: Department[];
  term: Term | undefined; canContinue: boolean; onNext: () => void;
}) {
  const desgMap = Object.fromEntries(designations.map(d => [d.designation_id, d]));
  const deptMap = Object.fromEntries(departments.map(d => [d.dept_id, d.dept_name]));

  if (!profile) return (
    <Card padding>
      <div className="flex items-start gap-3 text-amber-800">
        <AlertTriangleIcon className="w-5 h-5 mt-0.5 flex-shrink-0 text-amber-600" />
        <div>
          <p className="font-semibold">No active faculty profile is linked to your account</p>
          <p className="text-sm mt-1">Contact the administrator to link your account to, or reactivate, an existing faculty profile.</p>
        </div>
      </div>
    </Card>
  );

  const desig = profile.designation_id ? desgMap[profile.designation_id] : null;

  return (
    <div className="space-y-5">
      <Card padding>
        <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
          <UserIcon className="w-4 h-4 text-brand-600" /> Your Faculty Profile
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-400">Full Name</p>
            <p className="text-sm font-medium text-gray-900">{profile.name}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Faculty ID</p>
            <p className="text-sm font-medium text-gray-900">{profile.faculty_id}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Staff Code</p>
            <p className="text-sm text-gray-700">{profile.staff_code ?? <span className="text-gray-400">Not set</span>}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Department</p>
            <p className="text-sm text-gray-700">{profile.dept_id ? deptMap[profile.dept_id] : <span className="text-gray-400">Not assigned</span>}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Designation</p>
            {desig ? (
              <div className="flex items-center gap-2">
                <p className="text-sm text-gray-700">{desig.designation_name}</p>
                <Badge variant={desig.data_status === 'VERIFIED' ? 'green' : 'yellow'}>{desig.data_status}</Badge>
              </div>
            ) : (
              <p className="text-sm text-amber-700">Not set — workload limits cannot be applied</p>
            )}
          </div>
          <div>
            <p className="text-xs text-gray-400">Employment Type</p>
            <p className="text-sm text-gray-700">{profile.employment_type ?? <span className="text-gray-400">Not set</span>}</p>
          </div>
        </div>
        <p className="mt-4 text-xs text-gray-400 flex items-center gap-1">
          <InfoIcon className="w-3 h-3" /> Profile fields are managed by the administrator. Contact them for corrections.
        </p>
      </Card>

      {term && (
        <Card padding>
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <BookOpenIcon className="w-4 h-4 text-brand-600" /> Academic Term
          </h3>
          <div className="flex items-center gap-3">
            <div>
              <p className="text-sm font-medium text-gray-900">{term.term_name}</p>
              <p className="text-xs text-gray-400">{term.parity} · {term.start_date ?? 'Dates not set'} – {term.end_date ?? ''}</p>
            </div>
            <StatusBadge status={term.status} />
          </div>
        </Card>
      )}

      <div className="flex justify-end">
        <button className="btn-primary" onClick={onNext} disabled={!profile || !term || !canContinue}>
          Next: Select Preferences <ArrowRightIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Subject Card ─────────────────────────────────────────────────────────────
function SubjectCard({
  course, selectedSlots, prefs, onSelect, onDeselect, isLocked, prefSlot,
}: {
  course: AvailableCourse;
  selectedSlots: Map<string, number>; // key -> preference slot (1-indexed)
  prefs: PrefRow[];
  onSelect: (course_id: string, component_id: string, course: AvailableCourse, comp_type: string | null) => void;
  onDeselect: (key: string) => void;
  isLocked: boolean;
  prefSlot: (key: string) => number | null; // returns slot number if already selected
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`border rounded-xl p-4 transition-all ${prefs.some(p => p.course_id === String(course.course_id)) ? 'border-brand-400 bg-brand-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {course.course_code && (
              <span className="text-xs font-mono font-semibold text-brand-700 bg-brand-50 border border-brand-200 px-1.5 py-0.5 rounded">{course.course_code}</span>
            )}
            {course.category && <Badge variant="yellow">{course.category}</Badge>}
            {course.credits && <span className="text-xs text-gray-400">{course.credits} credits</span>}
          </div>
          <p className="text-sm font-semibold text-gray-900 mt-1">{course.course_name}</p>
          {course.dept_name && (
            <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
              <BuildingIcon className="w-3 h-3" />{course.dept_name}
            </p>
          )}
          {course.programs.length > 0 && (
            <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1 flex-wrap">
              <GraduationCapIcon className="w-3 h-3 flex-shrink-0" />
              {course.programs.slice(0, 2).map((p, i) => (
                <span key={i}>{p.program_code} Sem {p.semester_no}{i < Math.min(course.programs.length, 2) - 1 ? ',' : ''}</span>
              ))}
              {course.programs.length > 2 && <span className="text-gray-300">+{course.programs.length - 2} more</span>}
            </p>
          )}
        </div>
        <button className="text-xs text-gray-400 hover:text-gray-600 flex-shrink-0" onClick={() => setExpanded(e => !e)}>
          {expanded ? 'less' : 'details'}
        </button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
          {course.programs.map((p, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
              <GraduationCapIcon className="w-3 h-3 text-gray-400 flex-shrink-0" />
              <span>{p.program_name} ({p.program_code}) — Semester {p.semester_no}{p.semester_name ? ` (${p.semester_name})` : ''}</span>
            </div>
          ))}
          {course.programs.length === 0 && <p className="text-xs text-gray-400">Not linked to any program curriculum.</p>}
        </div>
      )}

      {/* Components / selection */}
      <div className="mt-3 space-y-2">
        {course.components.map(comp => {
          const key = `course:${course.course_id}-${comp.component_id}`;
          const slot = prefSlot(key);
          const alreadySelected = slot !== null;
          const canAdd = !isLocked && !alreadySelected && prefs.filter(p => p.course_id !== '').length < REQUIRED_PREFS;
          const alreadyThisCourse = prefs.some(p => p.course_id === String(course.course_id) && (p.component_id !== String(comp.component_id)));

          return (
            <div key={comp.component_id} className={`flex items-center gap-2 p-2.5 rounded-lg border ${alreadySelected ? 'border-brand-300 bg-brand-50' : 'border-gray-100 bg-gray-50'}`}>
              <Badge variant={compColor[comp.component_type] ?? 'blue'}>{comp.component_type}</Badge>
              <div className="flex-1 min-w-0">
                <span className="text-xs text-gray-700">
                  {comp.weekly_hours ? `${comp.weekly_hours}h/week` : '?h/week'}
                  {comp.periods_per_session ? ` · ${comp.periods_per_session} period${comp.periods_per_session > 1 ? 's' : ''}/session` : ''}
                  {comp.is_consecutive ? ' · consecutive' : ''}
                  {comp.required_room_type ? ` · needs ${comp.required_room_type}` : ''}
                  {(comp.audience_count ?? 0) > 0 ? ` · ${comp.audience_count} section${(comp.audience_count ?? 0) > 1 ? 's' : ''}` : ''}
                </span>
              </div>
              {alreadySelected ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-brand-700 bg-brand-100 px-2 py-0.5 rounded-full">#{slot}</span>
                  {!isLocked && (
                    <button className="text-red-400 hover:text-red-600" onClick={() => onDeselect(key)}>
                      <XIcon className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ) : (
                <button
                  className={`btn-sm text-xs px-2 py-1 rounded-lg border font-medium transition-colors ${canAdd && !alreadyThisCourse
                    ? 'border-brand-500 text-brand-700 hover:bg-brand-50'
                    : 'border-gray-200 text-gray-300 cursor-not-allowed'}`}
                  onClick={() => canAdd && !alreadyThisCourse && onSelect(String(course.course_id), String(comp.component_id), course, comp.component_type)}
                  disabled={!canAdd || alreadyThisCourse || isLocked}
                  title={
                    alreadyThisCourse ? 'A different component of this course is already selected'
                    : !canAdd && prefs.filter(p => p.course_id !== '').length >= REQUIRED_PREFS ? 'Already have 3 preferences'
                    : isLocked ? 'Locked'
                    : 'Add as preference'
                  }
                >
                  <PlusIcon className="w-3 h-3 inline" /> Add
                </button>
              )}
            </div>
          );
        })}
        {/* Course with no components — select the course itself */}
        {course.components.length === 0 && (() => {
          const key = `course:${course.course_id}-`;
          const slot = prefSlot(key);
          const alreadySelected = slot !== null;
          const canAdd = !isLocked && !alreadySelected && prefs.filter(p => p.course_id !== '').length < REQUIRED_PREFS;
          return (
            <div className="flex items-center gap-2 p-2.5 rounded-lg border border-gray-100 bg-gray-50">
              <span className="text-xs text-gray-400 flex-1">No components configured</span>
              {alreadySelected ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-brand-700 bg-brand-100 px-2 py-0.5 rounded-full">#{slot}</span>
                  {!isLocked && <button className="text-red-400 hover:text-red-600" onClick={() => onDeselect(key)}><XIcon className="w-3.5 h-3.5" /></button>}
                </div>
              ) : (
                <button
                  className={`btn-sm text-xs px-2 py-1 rounded-lg border font-medium ${canAdd ? 'border-brand-500 text-brand-700 hover:bg-brand-50' : 'border-gray-200 text-gray-300 cursor-not-allowed'}`}
                  onClick={() => canAdd && onSelect(String(course.course_id), '', course, null)}
                  disabled={!canAdd || isLocked}
                >
                  <PlusIcon className="w-3 h-3 inline" /> Add
                </button>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ─── Step 2: Subject Browser ──────────────────────────────────────────────────
function preferenceKey(pref: PrefRow): string {
  return pref.kind === 'SOURCE'
    ? `source:${pref.source_row_id}:${pref.source_subject_column}`
    : `course:${pref.course_id}-${pref.component_id}`;
}

function Step2Preferences({
  prefs, setPrefs, availableCourses, loading, isLocked, onNext, onBack,
}: {
  prefs: PrefRow[]; setPrefs: (p: PrefRow[]) => void;
  availableCourses: AvailableCourse[]; loading: boolean;
  isLocked: boolean; onNext: () => void; onBack: () => void;
}) {
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterComp, setFilterComp] = useState('');
  const [err, setErr] = useState('');

  // Build department list from courses
  const depts = [...new Map(availableCourses.filter(c => c.dept_name).map(c => [c.dept_id, c.dept_name])).entries()];

  // Filtered courses
  const filtered = availableCourses.filter(c => {
    if (filterDept && String(c.dept_id) !== filterDept) return false;
    if (filterComp && !c.components.some(comp => comp.component_type === filterComp)) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!c.course_name.toLowerCase().includes(s) && !(c.course_code?.toLowerCase().includes(s)) && !c.programs.some(p => p.program_name.toLowerCase().includes(s) || p.program_code.toLowerCase().includes(s))) return false;
    }
    return true;
  });

  function prefSlot(key: string): number | null {
    for (let i = 0; i < prefs.length; i++) {
      if (preferenceKey(prefs[i]) === key) return i + 1;
    }
    return null;
  }

  function handleSelect(course_id: string, component_id: string, course: AvailableCourse, comp_type: string | null) {
    if (prefs.length >= REQUIRED_PREFS) return;
    setPrefs([...prefs, {
      kind: 'COURSE',
      course_id, component_id, note: '',
      course_name: course.course_name,
      course_code: course.course_code,
      component_type: comp_type,
      weekly_hours: course.components.find(component => String(component.component_id) === component_id)?.weekly_hours,
    }]);
    setErr('');
  }

  function handleDeselect(key: string) {
    setPrefs(prefs.filter(p => preferenceKey(p) !== key));
  }

  function moveUp(i: number) {
    if (i === 0) return;
    const next = [...prefs]; [next[i], next[i-1]] = [next[i-1], next[i]];
    setPrefs(next);
  }
  function moveDown(i: number) {
    if (i >= prefs.length - 1) return;
    const next = [...prefs]; [next[i], next[i+1]] = [next[i+1], next[i]];
    setPrefs(next);
  }
  function updateNote(i: number, note: string) {
    setPrefs(prefs.map((p, idx) => idx === i ? { ...p, note } : p));
  }
  function remove(i: number) {
    setPrefs(prefs.filter((_, idx) => idx !== i));
  }

  function validate() {
    setErr('');
    if (prefs.length !== REQUIRED_PREFS) { setErr(`Exactly ${REQUIRED_PREFS} preferences required. You have ${prefs.length}.`); return false; }
    if (prefs.some(p => p.kind !== 'COURSE' || !p.course_id || !p.component_id)) {
      setErr('Please select a subject for each preference slot.'); return false;
    }
    const keys = prefs.map(preferenceKey);
    if (new Set(keys).size !== keys.length) { setErr('The same subject cannot appear twice.'); return false; }
    return true;
  }

  function handleNext() { if (validate()) onNext(); }

  if (loading) return <div className="text-sm text-gray-400 py-8 text-center">Loading subjects…</div>;

  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
        <strong>Select exactly {REQUIRED_PREFS} subjects</strong> in your preferred order. Preferences are requests to the department — not confirmed assignments. Use the numbered list below to reorder.
      </div>

      {/* Selected preferences bar */}
      <Card padding className="max-w-3xl">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">Selected Preferences</h3>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${prefs.length === REQUIRED_PREFS ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {prefs.length} / {REQUIRED_PREFS}
          </span>
        </div>
        {prefs.length === 0 ? (
          <p className="text-sm text-gray-400 py-2 text-center">No preferences selected yet. Browse subjects below and click Add.</p>
        ) : (
          <ol className="space-y-2">
            {prefs.map((p, i) => (
              <li key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                <span className="w-5 h-5 flex-shrink-0 rounded-full bg-brand-600 text-white text-xs flex items-center justify-center font-bold">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] uppercase tracking-wide text-gray-400">Rank {i + 1} · {['First', 'Second', 'Third'][i]} preference</p>
                  <p className="text-sm font-medium text-gray-900 truncate">{p.kind === 'SOURCE' ? p.source_label : p.course_name ?? `Course ${p.course_id}`}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    {p.kind === 'SOURCE' ? (
                      <>
                        <Badge variant="yellow">Pending verification</Badge>
                        <span className="text-xs text-gray-400">Source row {p.source_row_number} · {p.source_hours ?? '?'}h/week</span>
                      </>
                    ) : p.course_code && <span className="text-xs text-gray-400">{p.course_code}</span>}
                    {p.component_type && <Badge variant={compColor[p.component_type] ?? 'blue'}>{p.component_type}</Badge>}
                  </div>
                </div>
                <input
                  className="input text-xs py-1 w-36 hidden sm:block"
                  placeholder="Optional note…"
                  value={p.note}
                  onChange={e => updateNote(i, e.target.value)}
                  disabled={isLocked}
                />
                {!isLocked && (
                  <div className="flex items-center gap-0.5">
                    <button className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30" onClick={() => moveUp(i)} disabled={i === 0}><ChevronUpIcon className="w-3.5 h-3.5" /></button>
                    <button className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30" onClick={() => moveDown(i)} disabled={i >= prefs.length - 1}><ChevronDownIcon className="w-3.5 h-3.5" /></button>
                    <button className="p-1 text-red-400 hover:text-red-600" onClick={() => remove(i)}><Trash2Icon className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
        {err && <FormError message={err} />}
      </Card>

      {/* Subject browser */}
      {!isLocked && (
        <div className="max-w-3xl space-y-3">
          {/* Search + filters */}
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-52">
              <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                className="input pl-8"
                placeholder="Search by subject name, code or program…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" onClick={() => setSearch('')}>
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1">
              <FilterIcon className="w-4 h-4 text-gray-400" />
              <select className="input w-44" value={filterDept} onChange={e => setFilterDept(e.target.value)}>
                <option value="">All departments</option>
                {depts.map(([id, name]) => <option key={String(id)} value={String(id ?? '')}>{name}</option>)}
              </select>
              <select className="input w-36" value={filterComp} onChange={e => setFilterComp(e.target.value)}>
                <option value="">All types</option>
                <option value="THEORY">Theory</option>
                <option value="LAB">Lab</option>
                <option value="TUTORIAL">Tutorial</option>
                <option value="PROJECT">Project</option>
              </select>
            </div>
          </div>

          {availableCourses.length === 0 ? (
            <Card padding>
              <div className="py-6 text-center">
                <BookOpenIcon className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm font-medium text-gray-600">No subjects offered in the current term</p>
                <p className="text-xs text-gray-400 mt-1">Contact the administrator to configure course offerings for this term.</p>
              </div>
            </Card>
          ) : filtered.length === 0 ? (
            <div className="py-6 text-center text-sm text-gray-400">
              No subjects match your search. <button className="text-brand-600 hover:underline" onClick={() => { setSearch(''); setFilterDept(''); setFilterComp(''); }}>Clear filters</button>
            </div>
          ) : (
            <div className="space-y-3 max-h-[28rem] overflow-y-auto pr-1">
              {filtered.length > 0 && <>
                <p className="text-xs text-gray-400">{filtered.length} confirmed catalogue subject{filtered.length !== 1 ? 's' : ''} offered this term</p>
                {filtered.map(c => (
                <SubjectCard
                  key={c.course_id}
                  course={c}
                  selectedSlots={new Map()}
                  prefs={prefs}
                  onSelect={handleSelect}
                  onDeselect={handleDeselect}
                  isLocked={isLocked || prefs.length >= REQUIRED_PREFS}
                  prefSlot={prefSlot}
                />
                ))}
              </>}
            </div>
          )}
        </div>
      )}

      {isLocked && (
        <Card padding className="max-w-2xl">
          <p className="text-sm text-gray-500">Preferences are locked after submission.</p>
        </Card>
      )}

      <div className="flex justify-between max-w-3xl">
        <button className="btn-secondary" onClick={onBack}><ArrowLeftIcon className="w-4 h-4" /> Back</button>
        <button className="btn-primary" onClick={handleNext}>
          Next: Availability <ArrowRightIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: Availability ─────────────────────────────────────────────────────
function Step3Availability({
  windows, setWindows, isLocked, onNext, onBack,
}: {
  windows: AvWindow[]; setWindows: (w: AvWindow[]) => void;
  isLocked: boolean; onNext: () => void; onBack: () => void;
}) {
  const [err, setErr] = useState('');

  function addWindow() {
    setWindows([...windows, { day: 'MON', start_time: '09:00', end_time: '10:00', availability_type: 'UNKNOWN' }]);
  }
  function removeWindow(i: number) { setWindows(windows.filter((_, idx) => idx !== i)); }
  function updateWindow(i: number, field: keyof AvWindow, val: string) {
    setWindows(windows.map((w, idx) => idx === i ? { ...w, [field]: val } : w));
  }

  function handleNext() {
    setErr('');
    for (const w of windows) {
      if (w.end_time <= w.start_time) { setErr('End time must be after start time for all windows.'); return; }
    }
    onNext();
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
        <strong>Important:</strong> Time windows you do not record are treated as <strong>UNKNOWN</strong> — never assumed available.
        Explicitly mark times when you are AVAILABLE or UNAVAILABLE.
      </div>

      <Card padding className="max-w-3xl">
        <div className="space-y-2 mb-4">
          {windows.length === 0 && (
            <p className="text-sm text-gray-400 py-4 text-center">No windows recorded. All periods will be treated as UNKNOWN.</p>
          )}
          {windows.map((w, i) => (
            <div key={i} className="flex items-center gap-2 flex-wrap sm:flex-nowrap py-1">
              <select className="input w-24" value={w.day} onChange={e => updateWindow(i, 'day', e.target.value)} disabled={isLocked}>
                {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <input type="time" className="input w-32" value={w.start_time.slice(0, 5)} onChange={e => updateWindow(i, 'start_time', e.target.value + ':00')} disabled={isLocked} />
              <span className="text-gray-400 text-sm flex-shrink-0">to</span>
              <input type="time" className="input w-32" value={w.end_time.slice(0, 5)} onChange={e => updateWindow(i, 'end_time', e.target.value + ':00')} disabled={isLocked} />
              <select className="input flex-1 min-w-[150px]" value={w.availability_type} onChange={e => updateWindow(i, 'availability_type', e.target.value)} disabled={isLocked}>
                {AV_TYPES.map(t => <option key={t} value={t}>{avLabel[t]}</option>)}
              </select>
              <Badge variant={avColor[w.availability_type]}>{w.availability_type}</Badge>
              {!isLocked && (
                <button className="btn-ghost btn-sm text-red-500 p-1.5" onClick={() => removeWindow(i)}>
                  <Trash2Icon className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>

        {!isLocked && (
          <button className="btn-secondary btn-sm" onClick={addWindow}>
            <PlusIcon className="w-4 h-4" /> Add Window
          </button>
        )}
        {err && <FormError message={err} />}
        {isLocked && <p className="text-sm text-gray-500 mt-3">Availability is locked after submission.</p>}
      </Card>

      <div className="flex justify-between max-w-3xl">
        <button className="btn-secondary" onClick={onBack}><ArrowLeftIcon className="w-4 h-4" /> Back</button>
        <button className="btn-primary" onClick={handleNext}>
          Next: Review <ArrowRightIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Step 4: Review & Submit ──────────────────────────────────────────────────
function Step4Review({
  profile, term, curriculum, prefs, windows, detail, isLocked,
  onBack, onSaveDraft, onSubmit, saving, submitting, saveError, submitError,
}: {
  profile: FacultyProfile | null | undefined; term: Term | undefined; curriculum: CurriculumChoice | undefined;
  prefs: PrefRow[]; windows: AvWindow[];
  detail: SubmissionDetail | undefined;
  isLocked: boolean; onBack: () => void;
  onSaveDraft: () => void; onSubmit: () => void;
  saving: boolean; submitting: boolean;
  saveError: string; submitError: string;
}) {
  const sub = detail?.submission;
  const canSubmit = !!curriculum && prefs.length === REQUIRED_PREFS && prefs.every(p =>
    p.kind === 'COURSE' && !!p.course_id && !!p.component_id,
  );

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Reviewer comment */}
      {sub?.review_comment && (
        <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-4 flex items-start gap-3">
          <AlertTriangleIcon className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-yellow-800">Department feedback</p>
            <p className="text-sm text-yellow-700 mt-1">{sub.review_comment}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Profile summary */}
        <Card padding>
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <UserIcon className="w-4 h-4 text-brand-600" /> Faculty Profile
          </h3>
          <p className="text-sm font-medium text-gray-900">{profile?.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">{profile?.staff_code ?? 'No staff code'} · ID {profile?.faculty_id}</p>
          {term && <p className="text-xs text-gray-500 mt-2">Term: <strong>{term.term_name}</strong></p>}
          {curriculum && <p className="text-xs text-gray-500 mt-1">Curriculum: <strong>{curriculum.program_code} · Semester {curriculum.semester_no}</strong></p>}
          {sub && (
            <div className="mt-3 flex gap-2 flex-wrap">
              <StatusBadge status={sub.submission_status} />
              <StatusBadge status={sub.review_status} />
            </div>
          )}
        </Card>

        {/* Preferences summary */}
        <Card padding>
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <BookOpenIcon className="w-4 h-4 text-brand-600" /> Subject Preferences
          </h3>
          {prefs.length === 0
            ? <p className="text-sm text-red-600">No preferences selected. Go back to add {REQUIRED_PREFS}.</p>
            : <ol className="space-y-2">
                {prefs.map((p, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="w-5 h-5 flex-shrink-0 rounded-full bg-brand-600 text-white text-xs flex items-center justify-center font-bold mt-0.5">{i + 1}</span>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-gray-400">Rank {i + 1} · {['First', 'Second', 'Third'][i]} preference</p>
                      <p className="text-sm text-gray-900">{p.kind === 'SOURCE' ? p.source_label : p.course_name ?? `Course ${p.course_id}`}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        {p.kind === 'SOURCE' ? (
                          <>
                            <Badge variant="yellow">Pending verification</Badge>
                            <span className="text-xs text-gray-400">Source row {p.source_row_number}</span>
                          </>
                        ) : p.course_code && <span className="text-xs text-gray-400">{p.course_code}</span>}
                        {p.component_type && <Badge variant={compColor[p.component_type] ?? 'blue'}>{p.component_type}</Badge>}
                        {p.kind === 'COURSE' && <span className="text-xs text-gray-400">{p.weekly_hours ?? '?'}h/week</span>}
                      </div>
                      {p.note && <p className="text-xs text-gray-400 mt-0.5">"{p.note}"</p>}
                    </div>
                  </li>
                ))}
              </ol>
          }
          {prefs.length !== REQUIRED_PREFS && (
            <p className="mt-2 text-xs text-red-600 font-medium">⚠ {REQUIRED_PREFS} preferences required to submit ({prefs.length} selected)</p>
          )}
        </Card>

        {/* Availability summary */}
        <Card padding className="lg:col-span-2">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <ClockIcon className="w-4 h-4 text-brand-600" /> Availability Windows
          </h3>
          {windows.length === 0
            ? <p className="text-sm text-amber-700">No windows recorded. All periods will be marked as UNKNOWN.</p>
            : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {windows.map((w, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg text-xs">
                    <span className="font-medium text-gray-700 w-8">{w.day}</span>
                    <span className="text-gray-500">{w.start_time.slice(0, 5)} – {w.end_time.slice(0, 5)}</span>
                    <Badge variant={avColor[w.availability_type]}>{w.availability_type}</Badge>
                  </div>
                ))}
              </div>
          }
        </Card>
      </div>

      {saveError && <FormError message={saveError} />}
      {submitError && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{submitError}</div>}

      {isLocked && (
        <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 text-sm text-gray-600">
          <CheckCircleIcon className="w-4 h-4 inline mr-1.5 text-green-500" />
          Your submitted form is locked. Preferences remain requests and are not confirmed teaching assignments.
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        <button className="btn-secondary" onClick={onBack} disabled={saving || submitting}>
          <ArrowLeftIcon className="w-4 h-4" /> Back
        </button>
        {!isLocked && (
          <div className="flex gap-3">
            <button className="btn-secondary" onClick={onSaveDraft} disabled={saving || submitting}>
              <SaveIcon className="w-4 h-4" /> {saving ? 'Saving…' : 'Save Draft'}
            </button>
            <button
              className="btn-primary"
              onClick={onSubmit}
              disabled={submitting || saving || !canSubmit}
              title={!canSubmit ? `Select exactly ${REQUIRED_PREFS} subjects to submit` : undefined}
            >
              <SendIcon className="w-4 h-4" /> {submitting ? 'Submitting…' : 'Submit for Review'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export function PreferencesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selectedTermId, setSelectedTermId] = useState('');
  const [selectedYearId, setSelectedYearId] = useState<number | null>(null);
  const [selectedParity, setSelectedParity] = useState<Term['parity']>('ODD');
  const [selectedProgramId, setSelectedProgramId] = useState<number>();
  const [selectedSemesterId, setSelectedSemesterId] = useState<number>();
  const [step, setStep] = useState(1);
  const [prefs, setPrefs] = useState<PrefRow[]>([]);
  const [windows, setWindows] = useState<AvWindow[]>([]);
  const [saveError, setSaveError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // ── Data fetching ──────────────────────────────────────────────────────────
  const profileQuery = useFacultyProfile();
  const {
    data: profile,
    isPending: profileLoading,
    error: profileError,
  } = profileQuery;

  const { data: designations = [] } = useQuery({
    queryKey: ['designations'],
    queryFn: () => listRequest<Designation>('/masterdata/designations?limit=200'),
    select: r => r.data,
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => listRequest<Department>('/masterdata/departments?limit=200'),
    select: r => r.data,
  });

  const {
    data: activeTerms = [],
    isPending: termsLoading,
    error: termsError,
  } = useQuery({
    queryKey: ['terms-active'],
    queryFn: () => listRequest<Term>('/masterdata/terms?status=ACTIVE&limit=500'),
    select: r => r.data,
  });
  const { data: academicYears = [], isPending: academicYearsLoading, error: academicYearsError } = useQuery({
    queryKey: ['academic-years'],
    queryFn: () => listRequest<AcademicYear>('/masterdata/academic-years?limit=500'),
    select: r => r.data,
  });
  const selectableTerms = activeFacultyTerms(academicYears, activeTerms);
  const availableAcademicYears = activeFacultyYears(academicYears);
  const termStorageKey = `slotify:faculty-term:${user?.userId ?? 'unknown'}`;
  useEffect(() => {
    if (termsLoading || academicYearsLoading) return;
    if (availableAcademicYears.some(year => year.year_id === selectedYearId)) return;
    const nextTerm = initialFacultyTerm(selectableTerms, sessionStorage.getItem(termStorageKey));
    if (nextTerm) {
      setSelectedYearId(nextTerm.year_id);
      setSelectedParity(nextTerm.parity);
      setSelectedTermId(String(nextTerm.term_id));
    } else if (academicYears.length) {
      setSelectedYearId(availableAcademicYears[0]?.year_id ?? null);
      setSelectedTermId('');
    } else {
      setSelectedYearId(null);
      setSelectedTermId('');
    }
  }, [academicYears.length, academicYearsLoading, availableAcademicYears, selectedYearId, selectableTerms, termStorageKey, termsLoading]);
  const termsForSelection = filterFacultyTerms(selectableTerms, selectedYearId, selectedParity);
  useEffect(() => {
    if (selectedTermId && !termsForSelection.some(candidate => String(candidate.term_id) === selectedTermId)) {
      setSelectedTermId('');
    }
  }, [selectedTermId, termsForSelection]);
  useEffect(() => {
    if (termsForSelection.some(candidate => String(candidate.term_id) === selectedTermId)) {
      sessionStorage.setItem(termStorageKey, selectedTermId);
    }
  }, [selectedTermId, termStorageKey, termsForSelection]);
  const term = termsForSelection.find(candidate => String(candidate.term_id) === selectedTermId);

  const {
    data: curriculumChoices = [],
    isFetching: curriculumChoicesLoading,
    error: curriculumChoicesError,
  } = useQuery<CurriculumChoice[]>({
    queryKey: ['faculty-term-curricula', term?.term_id],
    queryFn: () => api.get<CurriculumChoice[]>(`/faculty-submissions/mine/term-program-semesters?term_id=${term!.term_id}`),
    enabled: !!term && !!profile,
  });
  useEffect(() => {
    if (!curriculumChoices.length) {
      setSelectedProgramId(undefined);
      setSelectedSemesterId(undefined);
      return;
    }
    const current = curriculumChoices.find(choice =>
      choice.program_id === selectedProgramId && choice.semester_id === selectedSemesterId,
    );
    if (!current) {
      setSelectedProgramId(curriculumChoices[0].program_id);
      setSelectedSemesterId(curriculumChoices[0].semester_id);
    }
  }, [curriculumChoices, selectedProgramId, selectedSemesterId]);
  const curriculum = curriculumChoices.find(choice =>
    choice.program_id === selectedProgramId && choice.semester_id === selectedSemesterId,
  );
  const {
    data: detail,
    fetchStatus: detailFetch,
    error: detailError,
    refetch: refetchDetail,
  } = useQuery<SubmissionDetail>({
    queryKey: ['my-submission', term?.term_id],
    queryFn: () => api.get<SubmissionDetail>(`/faculty-submissions/mine?term_id=${term!.term_id}`),
    enabled: !!term && !!profile,
    staleTime: 10_000,
  });
  const detailEditorState = facultySubmissionEditorState({
    enabled: !!term && !!profile,
    isFetching: detailFetch === 'fetching',
    hasError: !!detailError,
    hasData: !!detail,
  });
  useEffect(() => {
    const savedSemesterId = detail?.preferences.find(preference => preference.semester_id != null)?.semester_id;
    if (savedSemesterId == null) return;
    const savedChoice = curriculumChoices.find(choice => choice.semester_id === savedSemesterId);
    if (savedChoice) {
      setSelectedProgramId(savedChoice.program_id);
      setSelectedSemesterId(savedChoice.semester_id);
    }
  }, [detail, curriculumChoices]);

  const { data: availableCoursesData, fetchStatus: coursesFetch, error: coursesError } = useQuery<AvailableCourse[]>({
    queryKey: ['available-courses', term?.term_id, curriculum?.program_id, curriculum?.semester_id],
    queryFn: () => api.get<AvailableCourse[]>(`/faculty-submissions/mine/available-courses?term_id=${term!.term_id}&program_id=${curriculum!.program_id}&semester_id=${curriculum!.semester_id}`),
    enabled: !!term && !!profile && !!curriculum,
  });
  const availableCourses = availableCoursesData ?? EMPTY_AVAILABLE_COURSES;

  // In TanStack v5, disabled queries have isLoading=true; use fetchStatus instead.
  const queryEnabled = !!term && !!profile;
  const detailLoading = queryEnabled && detailEditorState === 'loading';
  const coursesLoading = queryEnabled && !!curriculum && coursesFetch === 'fetching';

  useEffect(() => {
    setPrefs([]);
    setWindows([]);
    setStep(1);
    setSaveError('');
    setSubmitError('');
    setSuccessMsg('');
  }, [term?.term_id]);

  // Populate local state from loaded detail
  useEffect(() => {
    if (!detail) return;
    setPrefs(detail.preferences.map(p => {
      if (p.preference_kind === 'SOURCE') {
        return {
          kind: 'SOURCE' as const,
          course_id: '',
          component_id: '',
          source_row_id: String(p.source_row_id),
          source_subject_column: p.source_subject_column ?? '',
          source_label: p.source_label ?? 'Unverified workload label',
          source_page: p.source_page ?? undefined,
          source_row_number: p.source_row_number ?? undefined,
          source_hours: p.source_hours,
          note: p.note ?? '',
        };
      }
      return {
        kind: 'COURSE' as const,
        course_id: String(p.course_id),
        component_id: p.component_id ? String(p.component_id) : '',
        note: p.note ?? '',
        course_name: p.course_name ?? `Course ${p.course_id}`,
        course_code: p.course_code,
        component_type: p.component_type,
        weekly_hours: p.weekly_hours,
      };
    }));
    setWindows(detail.availability
      .filter(a => a.source === 'FACULTY_SUBMISSION')
      .map(a => ({ day: a.day, start_time: a.start_time, end_time: a.end_time, availability_type: a.availability_type }))
    );
  }, [detail]);

  const isSubmitted = detail?.submission?.submission_status === 'SUBMITTED';
  const isReturned = detail?.submission?.submission_status === 'RETURNED';
  const isLocked = isSubmitted;

  // ── Mutations ──────────────────────────────────────────────────────────────
  const buildPayload = useCallback(() => ({
    term_id: term!.term_id,
    program_id: curriculum!.program_id,
    semester_id: curriculum!.semester_id,
    preferences: prefs.map(p => p.kind === 'SOURCE'
      ? {
          source_row_id: Number(p.source_row_id),
          subject_column: p.source_subject_column,
          note: p.note || undefined,
        }
      : {
          course_id: parseInt(p.course_id),
          component_id: p.component_id ? parseInt(p.component_id) : undefined,
          note: p.note || undefined,
        }),
    availability: windows.map(w => ({ day: w.day, start_time: w.start_time, end_time: w.end_time, availability_type: w.availability_type })),
  }), [term, curriculum, prefs, windows]);

  const saveMutation = useMutation({
    mutationFn: () => api.put('/faculty-submissions/mine', buildPayload()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-submission'] });
      setSaveError(''); setSuccessMsg('Draft saved successfully.');
      setTimeout(() => setSuccessMsg(''), 4000);
    },
    onError: (e: any) => { setSaveError(e?.error?.message ?? 'Save failed'); setSuccessMsg(''); },
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      await api.put('/faculty-submissions/mine', buildPayload());
      return api.post('/faculty-submissions/mine/submit', { term_id: term!.term_id });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-submission'] });
      qc.invalidateQueries({ queryKey: ['my-track'] });
      setSubmitError(''); setSuccessMsg('Submitted for review successfully!');
    },
    onError: (e: any) => { setSubmitError(e?.error?.message ?? 'Submission failed'); setSuccessMsg(''); },
  });

  // ── Render ─────────────────────────────────────────────────────────────────
  if (profileLoading || profileError || profile === null) {
    return <FacultyProfileStatus query={profileQuery} />;
  }

  if (detailEditorState === 'error') {
    return (
      <div className="max-w-3xl space-y-4">
        <PageHeader title="Subject Preferences & Availability" />
        <ErrorMessage error={detailError} title="Unable to load your current submission" />
        <p className="text-sm text-amber-800">Editing and saving are disabled until the selected term's current submission loads successfully.</p>
        <button type="button" className="btn-secondary btn-sm" onClick={() => void refetchDetail()}>
          Retry loading submission
        </button>
      </div>
    );
  }

  if (termsError || academicYearsError || curriculumChoicesError || coursesError) {
    return (
      <div className="max-w-3xl space-y-4">
        <PageHeader title="Subject Preferences & Availability" />
        <ErrorMessage error={termsError ?? academicYearsError ?? curriculumChoicesError ?? coursesError} title="Unable to load your form details" />
      </div>
    );
  }

  if (termsLoading || academicYearsLoading) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="Subject Preferences & Availability" />
        <div className="py-8 text-center text-sm text-gray-500">Loading your form details…</div>
      </div>
    );
  }

  if (detailLoading) return <div className="text-sm text-gray-400 py-8 text-center">Loading your submission…</div>;

  if (!term) return (
    <div>
      <PageHeader title="Subject Preferences & Availability" />
      <Card padding>
        <FacultyTermContextSelector
          academicYears={availableAcademicYears}
          terms={selectableTerms}
          yearId={selectedYearId}
          parity={selectedParity}
          termId={selectedTermId}
          onYearChange={yearId => {
            setSelectedYearId(yearId);
            setSelectedTermId(String(filterFacultyTerms(selectableTerms, yearId, selectedParity)[0]?.term_id ?? ''));
          }}
          onParityChange={parity => {
            setSelectedParity(parity);
            setSelectedTermId(String(filterFacultyTerms(selectableTerms, selectedYearId, parity)[0]?.term_id ?? ''));
          }}
          onTermChange={setSelectedTermId}
        />
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          No active academic term is configured for this academic year and parity. Select another context or contact the administrator.
        </p>
      </Card>
    </div>
  );

  const reviewStatus = detail?.submission?.review_status;
  const isAccepted = reviewStatus === 'ACCEPTED';
  const statusHeader = isSubmitted
    ? isAccepted
      ? 'Preferences Accepted'
      : reviewStatus === 'IN_REVIEW'
        ? 'In Review'
        : 'Submitted — Awaiting Review'
    : isReturned
      ? 'Returned for Changes'
      : detail?.submission?.submission_status === 'DRAFT'
        ? 'Draft in Progress'
        : 'Not Started';

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Subject Preferences & Availability"
        subtitle={`${term.term_name} · ${statusHeader}`}
      />

      <Card padding className="mb-6">
        <div className="grid gap-4">
          <FacultyTermContextSelector
            academicYears={availableAcademicYears}
            terms={selectableTerms}
            yearId={selectedYearId}
            parity={selectedParity}
            termId={selectedTermId}
            disabled={isLocked}
            onYearChange={yearId => {
              setSelectedYearId(yearId);
              setSelectedTermId(String(filterFacultyTerms(selectableTerms, yearId, selectedParity)[0]?.term_id ?? ''));
            }}
            onParityChange={parity => {
              setSelectedParity(parity);
              setSelectedTermId(String(filterFacultyTerms(selectableTerms, selectedYearId, parity)[0]?.term_id ?? ''));
            }}
            onTermChange={setSelectedTermId}
          />
          <div>
            <label className="label" htmlFor="preference-curriculum">Program & Semester</label>
            <select id="preference-curriculum" className="input"
              value={curriculum ? `${curriculum.program_id}:${curriculum.semester_id}` : ''}
              disabled={isLocked || curriculumChoicesLoading || curriculumChoices.length === 0}
              onChange={e => {
                const choice = curriculumChoices.find(option => `${option.program_id}:${option.semester_id}` === e.target.value);
                setSelectedProgramId(choice?.program_id);
                setSelectedSemesterId(choice?.semester_id);
                setPrefs([]);
                setStep(1);
              }}>
              <option value="">{curriculumChoicesLoading ? 'Loading applicable programs…' : 'No applicable program semesters'}</option>
              {curriculumChoices.map(choice => (
                <option key={`${choice.program_id}:${choice.semester_id}`} value={`${choice.program_id}:${choice.semester_id}`}>
                  {choice.program_code} — Semester {choice.semester_no}{choice.semester_name ? ` (${choice.semester_name})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        {!curriculumChoicesLoading && !curriculum && (
          <p className="mt-3 text-sm text-amber-800">No active program semesters are configured for this term. Contact the administrator; unmapped or unpublished subjects are not available.</p>
        )}
      </Card>

      {isSubmitted && (
        <div className="mb-6 rounded-lg bg-green-50 border border-green-200 p-4 flex items-start gap-3">
          <CheckCircleIcon className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-green-800">
              {isAccepted ? 'Preferences reviewed and accepted' : reviewStatus === 'IN_REVIEW' ? 'Form is being reviewed' : 'Form submitted — awaiting review'}
            </p>
            <p className="text-sm text-green-700 mt-0.5">Review status: <strong>{detail?.submission?.review_status?.replace(/_/g, ' ')}</strong></p>
            <p className="text-xs text-green-600 mt-1">
              {isAccepted
                ? 'These preferences are requests, not confirmed teaching assignments.'
                : 'Your form is locked while the department completes its review.'}
            </p>
          </div>
        </div>
      )}

      {isReturned && detail?.submission?.review_comment && (
        <div className="mb-6 rounded-lg bg-yellow-50 border border-yellow-200 p-4 flex items-start gap-3">
          <AlertTriangleIcon className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-yellow-800">Returned for changes</p>
            <p className="text-sm text-yellow-700 mt-1">{detail.submission.review_comment}</p>
          </div>
        </div>
      )}

      {successMsg && (
        <div className="mb-4 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700 flex items-center gap-2">
          <CheckCircleIcon className="w-4 h-4" /> {successMsg}
        </div>
      )}

      <StepBar step={step} locked={isLocked} />

      {step === 1 && (
        <>
          {!curriculum && <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">An active program and semester mapping is required before you can choose subjects.</p>}
          <Step1Profile profile={profile} designations={designations} departments={departments} term={term} canContinue={!!curriculum} onNext={() => setStep(2)} />
        </>
      )}
      {step === 2 && (
        <Step2Preferences
          prefs={prefs} setPrefs={setPrefs}
          availableCourses={availableCourses} loading={coursesLoading}
          isLocked={isLocked} onNext={() => setStep(3)} onBack={() => setStep(1)}
        />
      )}
      {step === 3 && (
        <Step3Availability
          windows={windows} setWindows={setWindows}
          isLocked={isLocked} onNext={() => setStep(4)} onBack={() => setStep(2)}
        />
      )}
      {step === 4 && (
        <Step4Review
          profile={profile} term={term} curriculum={curriculum}
          prefs={prefs} windows={windows} detail={detail}
          isLocked={isLocked} onBack={() => setStep(3)}
          onSaveDraft={() => { setSaveError(''); saveMutation.mutate(); }}
          onSubmit={() => { setSubmitError(''); submitMutation.mutate(); }}
          saving={saveMutation.isPending} submitting={submitMutation.isPending}
          saveError={saveError} submitError={submitError}
        />
      )}
    </div>
  );
}
