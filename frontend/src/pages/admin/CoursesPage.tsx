import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PlusIcon, PencilIcon, Trash2Icon, CalendarDaysIcon } from 'lucide-react';
import { api, listRequest } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Modal, ConfirmModal } from '@/components/ui/Modal';
import { ErrorMessage, FormError } from '@/components/ui/ErrorMessage';
import type { Course, CourseComponent, CourseOffering, Department, RoomType, Term } from '@/types';
import { Link, useSearchParams } from 'react-router-dom';
import { CurriculumBuilder } from './CurriculumBuilder';

type Tab = 'courses' | 'components' | 'offerings' | 'curriculum';
const COMPONENT_TYPES = ['THEORY', 'TUTORIAL', 'LAB', 'PROJECT'] as const;
const DATA_STATUSES = ['VERIFIED', 'VERIFY', 'DISCREPANCY', 'SYNTHETIC'] as const;
const componentTypeColor: Record<string, 'blue' | 'green' | 'yellow' | 'purple'> = {
  THEORY: 'blue', LAB: 'green', TUTORIAL: 'yellow', PROJECT: 'purple',
};

// ── Course Modal ──────────────────────────────────────────────────────────────
function CourseModal({ open, onClose, editing, departments }: {
  open: boolean; onClose: () => void; editing: Course | null; departments: Department[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState(editing
    ? { dept_id: editing.dept_id != null ? String(editing.dept_id) : '', course_code: editing.course_code ?? '', course_name: editing.course_name, credits: editing.credits != null ? String(editing.credits) : '', category: editing.category ?? '', is_active: editing.is_active, data_status: editing.data_status }
    : { dept_id: '', course_code: '', course_name: '', credits: '', category: '', is_active: 1, data_status: 'VERIFY' }
  );
  const [err, setErr] = useState('');

  const mut = useMutation({
    mutationFn: (b: any) => editing ? api.patch(`/masterdata/courses/${editing.course_id}`, b) : api.post('/masterdata/courses', b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['courses'] }); onClose(); },
    onError: (e: any) => setErr(e?.error?.message ?? 'Save failed'),
  });

  if (!open) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const b: any = { course_name: form.course_name, is_active: form.is_active, data_status: form.data_status };
    if (form.dept_id) b.dept_id = +form.dept_id;
    if (form.course_code.trim()) b.course_code = form.course_code.trim();
    if (form.credits !== '') b.credits = +form.credits;
    if (form.category.trim()) b.category = form.category.trim();
    mut.mutate(b);
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Course' : 'Add Course'} size="md">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Course Code (optional)</label>
            <input className="input" value={form.course_code} onChange={e => setForm(p => ({ ...p, course_code: e.target.value }))} placeholder="e.g. CS301" /></div>
          <div><label className="label">Category</label>
            <input className="input" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} placeholder="e.g. CORE" /></div>
        </div>
        <div><label className="label">Course Name</label>
          <input className="input" value={form.course_name} onChange={e => setForm(p => ({ ...p, course_name: e.target.value }))} required placeholder="e.g. Data Structures and Algorithms" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Department (optional)</label>
            <select className="input" value={form.dept_id} onChange={e => setForm(p => ({ ...p, dept_id: e.target.value }))}>
              <option value="">— None —</option>
              {departments.map(d => <option key={d.dept_id} value={d.dept_id}>{d.dept_name}</option>)}
            </select></div>
          <div><label className="label">Credits</label>
            <input type="number" className="input" min={0} max={99} step={0.5} value={form.credits} onChange={e => setForm(p => ({ ...p, credits: e.target.value }))} placeholder="e.g. 3" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Data Status</label>
            <select className="input" value={form.data_status} onChange={e => setForm(p => ({ ...p, data_status: e.target.value }))}>
              {DATA_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select></div>
          <div className="flex items-center gap-2 pt-6">
            <input type="checkbox" id="ca" checked={!!form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked ? 1 : 0 }))} />
            <label htmlFor="ca" className="text-sm">Active</label></div>
        </div>
        {err && <FormError message={err} />}
        <div className="flex justify-end gap-3 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={mut.isPending}>{mut.isPending ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Component Modal ───────────────────────────────────────────────────────────
function ComponentModal({ open, onClose, editing, courses, roomTypes }: {
  open: boolean; onClose: () => void; editing: CourseComponent | null; courses: Course[]; roomTypes: RoomType[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState(editing
    ? { course_id: editing.course_id, component_type: editing.component_type as string, weekly_hours: editing.weekly_hours != null ? String(editing.weekly_hours) : '', periods_per_session: editing.periods_per_session != null ? String(editing.periods_per_session) : '', is_consecutive: editing.is_consecutive, required_room_type_id: editing.required_room_type_id != null ? String(editing.required_room_type_id) : '', data_status: editing.data_status }
    : { course_id: courses[0]?.course_id ?? 0, component_type: 'THEORY', weekly_hours: '', periods_per_session: '', is_consecutive: 0, required_room_type_id: '', data_status: 'VERIFY' }
  );
  const [err, setErr] = useState('');

  const mut = useMutation({
    mutationFn: (b: any) => editing ? api.patch(`/masterdata/components/${editing.component_id}`, b) : api.post('/masterdata/components', b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['components'] }); onClose(); },
    onError: (e: any) => setErr(e?.error?.message ?? 'Save failed'),
  });

  if (!open) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const b: any = { is_consecutive: form.is_consecutive, data_status: form.data_status };
    if (!editing) { b.course_id = form.course_id; b.component_type = form.component_type; }
    if (form.weekly_hours !== '') b.weekly_hours = +form.weekly_hours;
    if (form.periods_per_session !== '') b.periods_per_session = +form.periods_per_session;
    if (form.required_room_type_id !== '') b.required_room_type_id = +form.required_room_type_id;
    mut.mutate(b);
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Component' : 'Add Component'} size="md">
      <form onSubmit={submit} className="space-y-4">
        {!editing && <>
          <div><label className="label">Course</label>
            <select className="input" value={form.course_id} onChange={e => setForm(p => ({ ...p, course_id: +e.target.value }))} required>
              {courses.map(c => <option key={c.course_id} value={c.course_id}>{c.course_name}{c.course_code ? ` (${c.course_code})` : ''}</option>)}
            </select></div>
          <div><label className="label">Component Type</label>
            <select className="input" value={form.component_type} onChange={e => setForm(p => ({ ...p, component_type: e.target.value }))}>
              {COMPONENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select></div>
        </>}
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Weekly Hours</label>
            <input type="number" className="input" min={0} max={99} step={0.5} value={form.weekly_hours} onChange={e => setForm(p => ({ ...p, weekly_hours: e.target.value }))} placeholder="e.g. 3" /></div>
          <div><label className="label">Periods / Session</label>
            <input type="number" className="input" min={1} max={12} value={form.periods_per_session} onChange={e => setForm(p => ({ ...p, periods_per_session: e.target.value }))} placeholder="e.g. 2" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Required Room Type (optional)</label>
            <select className="input" value={form.required_room_type_id} onChange={e => setForm(p => ({ ...p, required_room_type_id: e.target.value }))}>
              <option value="">— Any —</option>
              {roomTypes.map(r => <option key={r.room_type_id} value={r.room_type_id}>{r.type_name}</option>)}
            </select></div>
          <div><label className="label">Data Status</label>
            <select className="input" value={form.data_status} onChange={e => setForm(p => ({ ...p, data_status: e.target.value }))}>
              {DATA_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select></div>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="consec" checked={!!form.is_consecutive} onChange={e => setForm(p => ({ ...p, is_consecutive: e.target.checked ? 1 : 0 }))} />
          <label htmlFor="consec" className="text-sm">Consecutive sessions (requires periods ≥ 2)</label>
        </div>
        {err && <FormError message={err} />}
        <div className="flex justify-end gap-3 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={mut.isPending}>{mut.isPending ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

function OfferingModal({ open, onClose, editing, components, courses, terms }: {
  open: boolean;
  onClose: () => void;
  editing: CourseOffering | null;
  components: CourseComponent[];
  courses: Course[];
  terms: Term[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState(editing
    ? {
        component_id: String(editing.component_id),
        term_id: String(editing.term_id),
        offering_code: editing.offering_code ?? '',
        pattern_type: editing.pattern_type,
        status: editing.status,
        data_status: editing.data_status,
      }
    : {
        component_id: String(components[0]?.component_id ?? ''),
        term_id: String(terms.find(term => term.status === 'ACTIVE')?.term_id ?? terms.find(term => term.status !== 'CLOSED')?.term_id ?? ''),
        offering_code: '',
        pattern_type: 'WEEKLY',
        status: 'DRAFT',
        data_status: 'VERIFY',
      });
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => editing
      ? api.patch(`/masterdata/offerings/${editing.offering_id}`, body)
      : api.post('/masterdata/offerings', body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['offerings'] });
      await qc.invalidateQueries({ queryKey: ['available-courses'] });
      onClose();
    },
    onError: (e: any) => setError(e?.error?.message ?? 'Could not save offering'),
  });

  if (!open) return null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    const body: Record<string, unknown> = {
      offering_code: form.offering_code.trim() || null,
      pattern_type: form.pattern_type,
      status: form.status,
      data_status: form.data_status,
    };
    if (!editing) {
      body.component_id = Number(form.component_id);
      body.term_id = Number(form.term_id);
    }
    mutation.mutate(body);
  }

  function componentLabel(component: CourseComponent) {
    const course = courses.find(item => item.course_id === component.course_id);
    return `${course?.course_name ?? `Course ${component.course_id}`}${course?.course_code ? ` (${course.course_code})` : ''} · ${component.component_type} · ${component.weekly_hours ?? '?'}h/week`;
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Course Offering' : 'Add Course Offering'} size="md">
      <form onSubmit={submit} className="space-y-4">
        {!editing && <>
          <div>
            <label className="label">Course component</label>
            <select className="input" required value={form.component_id} onChange={event => setForm(current => ({ ...current, component_id: event.target.value }))}>
              {components.map(component => <option key={component.component_id} value={component.component_id}>{componentLabel(component)}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Academic term</label>
            <select className="input" required value={form.term_id} onChange={event => setForm(current => ({ ...current, term_id: event.target.value }))}>
              {terms.filter(term => term.status !== 'CLOSED').map(term => <option key={term.term_id} value={term.term_id}>{term.term_name} · {term.status}</option>)}
            </select>
          </div>
        </>}
        <div>
          <label className="label">Offering code (optional)</label>
          <input className="input" maxLength={40} value={form.offering_code} onChange={event => setForm(current => ({ ...current, offering_code: event.target.value }))} placeholder="College-approved code, if available" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Pattern</label>
            <select className="input" value={form.pattern_type} onChange={event => setForm(current => ({ ...current, pattern_type: event.target.value }))}>
              <option value="WEEKLY">Weekly</option><option value="IRREGULAR">Irregular</option><option value="CUSTOM">Custom</option>
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={form.status} onChange={event => setForm(current => ({ ...current, status: event.target.value }))}>
              <option value="DRAFT">Draft</option><option value="OFFERED">Offered</option><option value="CANCELLED">Cancelled</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">Data status</label>
          <select className="input" value={form.data_status} onChange={event => setForm(current => ({ ...current, data_status: event.target.value }))}>
            {DATA_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
          </select>
        </div>
        {!editing && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          Set status to Offered only after confirming the canonical course, component, hours, and term. Offered components become selectable in faculty preferences for that term.
        </p>}
        {error && <FormError message={error} />}
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={mutation.isPending || (!editing && (!components.length || !terms.some(term => term.status !== 'CLOSED')))}>
            {mutation.isPending ? 'Saving…' : 'Save offering'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export function CoursesPage() {
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab');
  const [tab, setTab] = useState<Tab>(
    initialTab === 'offerings' || initialTab === 'curriculum' ? initialTab : 'courses'
  );
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string; resource: string; qKey: string } | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const { data: courses = [], isLoading: lC, error: eC } = useQuery({ queryKey: ['courses'], queryFn: () => listRequest<Course>('/masterdata/courses?limit=500'), select: r => r.data });
  const { data: components = [], isLoading: lCo, error: eCo } = useQuery({ queryKey: ['components'], queryFn: () => listRequest<CourseComponent>('/masterdata/components?limit=500'), select: r => r.data });
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: () => listRequest<Department>('/masterdata/departments?limit=500'), select: r => r.data });
  const { data: roomTypes = [] } = useQuery({ queryKey: ['room-types'], queryFn: () => listRequest<RoomType>('/masterdata/room-types?limit=100'), select: r => r.data });
  const { data: terms = [] } = useQuery({ queryKey: ['terms'], queryFn: () => listRequest<Term>('/masterdata/terms?limit=500'), select: r => r.data });
  const { data: offerings = [], isLoading: lOf, error: eOf } = useQuery({ queryKey: ['offerings'], queryFn: () => listRequest<CourseOffering>('/masterdata/offerings?limit=500'), select: r => r.data });

  const courseMap = Object.fromEntries(courses.map(c => [c.course_id, c.course_name + (c.course_code ? ` (${c.course_code})` : '')]));
  const rtMap = Object.fromEntries(roomTypes.map(r => [r.room_type_id, r.type_name]));

  const deleteMut = useMutation({
    mutationFn: ({ id, resource }: { id: number; resource: string; qKey: string }) => api.delete(`/masterdata/${resource}/${id}`),
    onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: [v.qKey] }); setDeleteTarget(null); setDeleteError(''); },
    onError: (e: any) => setDeleteError(e?.error?.message ?? 'Cannot delete — record may be in use'),
  });

  const error = eC || eCo || eOf;
  if (error) return <ErrorMessage error={error} />;

  const filteredCourses = courses.filter(c => !search || c.course_name.toLowerCase().includes(search.toLowerCase()) || (c.course_code ?? '').toLowerCase().includes(search.toLowerCase()));
  const filteredComponents = components.filter(c => !search || courseMap[c.course_id]?.toLowerCase().includes(search.toLowerCase()));
  const filteredOfferings = offerings.filter(offering => {
    const component = components.find(item => item.component_id === offering.component_id);
    const course = component && courses.find(item => item.course_id === component.course_id);
    const term = terms.find(item => item.term_id === offering.term_id);
    const searchable = `${course?.course_name ?? ''} ${course?.course_code ?? ''} ${component?.component_type ?? ''} ${term?.term_name ?? ''} ${offering.offering_code ?? ''}`.toLowerCase();
    return !search || searchable.includes(search.toLowerCase());
  });

  function openCreate() { setEditing(null); setShowForm(true); }
  function openEdit(row: any) { setEditing(row); setShowForm(true); }
  function openDelete(id: number, label: string) {
    const r = tab === 'courses' ? 'courses' : tab === 'components' ? 'components' : 'offerings';
    setDeleteTarget({ id, label, resource: r, qKey: r });
    setDeleteError('');
  }

  const modalKey = `${tab}-${editing ? (tab === 'courses' ? editing.course_id : tab === 'components' ? editing.component_id : editing.offering_id) : 'new'}-${showForm}`;

  const actionCol = (row: any, idKey: string, labelKey: string) => (
    <div className="flex gap-1">
      <button className="btn-ghost btn-sm" onClick={() => openEdit(row)}><PencilIcon className="w-3.5 h-3.5" /></button>
      <button className="btn-ghost btn-sm text-red-500" onClick={() => openDelete(row[idKey], String(row[labelKey]))}><Trash2Icon className="w-3.5 h-3.5" /></button>
    </div>
  );

  return (
    <div>
      <PageHeader title="Courses & Curriculum" subtitle="Manage canonical courses, components, and term offerings."
        actions={tab !== 'curriculum' && <button className="btn-primary btn-sm" onClick={openCreate}><PlusIcon className="w-4 h-4" /> Add {tab === 'courses' ? 'Course' : tab === 'components' ? 'Component' : 'Offering'}</button>} />

      <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        Workbook abbreviations are not treated as canonical courses or codes until reviewed. Only course components offered for the selected term appear in faculty preferences.{' '}
        <Link className="font-semibold underline" to="/admin/workload-imports">Review CSE workload source</Link>.
      </div>

      <div className="flex gap-1 mb-5 border-b border-gray-200">
        {([{ key: 'courses' as Tab, label: 'Courses' }, { key: 'components' as Tab, label: 'Components' }, { key: 'offerings' as Tab, label: 'Term Offerings' }, { key: 'curriculum' as Tab, label: 'Curriculum Builder' }]).map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setShowForm(false); setSearch(''); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab !== 'curriculum' && <div className="mb-4">
        <input className="input max-w-xs" placeholder={tab === 'courses' ? 'Search by name or code…' : tab === 'components' ? 'Search by course name…' : 'Search by course, term, or code…'} value={search} onChange={e => setSearch(e.target.value)} />
      </div>}

      {tab === 'curriculum' && <CurriculumBuilder />}

      {tab === 'courses' && (
        <DataTable<Course> columns={[
          { header: 'Code', accessor: c => c.course_code ?? <span className="text-gray-400">—</span> },
          { header: 'Name', accessor: 'course_name' },
          { header: 'Credits', accessor: c => c.credits ?? '—' },
          { header: 'Category', accessor: c => c.category ?? '—' },
          { header: 'Status', accessor: c => <Badge variant={c.is_active ? 'green' : 'gray'}>{c.is_active ? 'Active' : 'Inactive'}</Badge> },
          { header: 'Data', accessor: c => <StatusBadge status={c.data_status} /> },
          { header: '', accessor: c => actionCol(c, 'course_id', 'course_name') },
        ]} data={filteredCourses} keyField="course_id" loading={lC} emptyTitle="No courses found" />
      )}

      {tab === 'components' && (
        <DataTable<CourseComponent> columns={[
          { header: 'Course', accessor: c => <span className="text-xs">{courseMap[c.course_id] ?? `ID ${c.course_id}`}</span> },
          { header: 'Type', accessor: c => <Badge variant={componentTypeColor[c.component_type] ?? 'gray'}>{c.component_type}</Badge> },
          { header: 'Weekly Hrs', accessor: c => c.weekly_hours ?? '—' },
          { header: 'Periods/Session', accessor: c => c.periods_per_session ?? '—' },
          { header: 'Consecutive', accessor: c => c.is_consecutive ? <Badge variant="blue">Yes</Badge> : <span className="text-gray-400">No</span> },
          { header: 'Room Type', accessor: c => c.required_room_type_id ? (rtMap[c.required_room_type_id] ?? c.required_room_type_id) : '—' },
          { header: 'Data', accessor: c => <StatusBadge status={c.data_status} /> },
          { header: '', accessor: c => actionCol(c, 'component_id', 'component_type') },
        ]} data={filteredComponents} keyField="component_id" loading={lCo} emptyTitle="No components found" />
      )}

      {tab === 'offerings' && (
        <>
          <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <CalendarDaysIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>Faculty preferences show components offered in the selected term. Confirm the official course identity, component, hours, and term before setting an offering to OFFERED. Source abbreviations are not automatically converted into courses.</p>
          </div>
          <DataTable<CourseOffering> columns={[
            { header: 'Course component', accessor: offering => {
              const component = components.find(item => item.component_id === offering.component_id);
              return <span className="text-xs">{component ? `${courseMap[component.course_id] ?? `Course ${component.course_id}`} · ${component.component_type}` : `Component ${offering.component_id}`}</span>;
            } },
            { header: 'Term', accessor: offering => terms.find(term => term.term_id === offering.term_id)?.term_name ?? `Term ${offering.term_id}` },
            { header: 'Offering code', accessor: offering => offering.offering_code ?? '—' },
            { header: 'Pattern', accessor: 'pattern_type' },
            { header: 'Status', accessor: offering => <Badge variant={offering.status === 'OFFERED' ? 'green' : offering.status === 'DRAFT' ? 'yellow' : 'gray'}>{offering.status}</Badge> },
            { header: 'Data', accessor: offering => <StatusBadge status={offering.data_status} /> },
            { header: '', accessor: offering => actionCol(offering, 'offering_id', 'offering_id') },
          ]} data={filteredOfferings} keyField="offering_id" loading={lOf} emptyTitle="No course offerings found" />
        </>
      )}

      {tab === 'courses' && <CourseModal key={modalKey} open={showForm} onClose={() => setShowForm(false)} editing={editing} departments={departments} />}
      {tab === 'components' && <ComponentModal key={modalKey} open={showForm} onClose={() => setShowForm(false)} editing={editing} courses={courses} roomTypes={roomTypes} />}
      {tab === 'offerings' && <OfferingModal key={modalKey} open={showForm} onClose={() => setShowForm(false)} editing={editing as CourseOffering | null} components={components} courses={courses} terms={terms} />}

      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => { setDeleteTarget(null); setDeleteError(''); }}
        onConfirm={() => deleteTarget && deleteMut.mutate({ id: deleteTarget.id, resource: deleteTarget.resource, qKey: deleteTarget.qKey })}
        title={`Delete ${tab === 'courses' ? 'Course' : tab === 'components' ? 'Component' : 'Offering'}`}
        message={`Delete "${deleteTarget?.label}"? If other records reference this, the delete will be blocked.`}
        confirmLabel="Delete" danger loading={deleteMut.isPending}>
        {deleteError && <p className="text-xs text-red-600 mt-2">{deleteError}</p>}
      </ConfirmModal>
    </div>
  );
}
