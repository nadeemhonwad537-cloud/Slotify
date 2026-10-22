import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PlusIcon, PencilIcon } from 'lucide-react';
import { api, listRequest } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { ErrorMessage, FormError } from '@/components/ui/ErrorMessage';
import { semestersForParity } from '@/lib/academicTermRules';
import type { AcademicYear, Term, Program, Scheme, Semester, Section, Batch, Department, TermProgramSemester } from '@/types';

type Tab = 'years' | 'terms' | 'programs' | 'schemes' | 'semesters' | 'termSemesters' | 'sections' | 'batches';

// ── Year Modal ────────────────────────────────────────────────────────────────
interface YearForm { year_label: string; start_date: string; end_date: string; is_active: number }

function YearModal({ open, onClose, editing }: { open: boolean; onClose: () => void; editing: AcademicYear | null }) {
  const qc = useQueryClient();
  const blank: YearForm = { year_label: '', start_date: '', end_date: '', is_active: 1 };
  const [form, setForm] = useState<YearForm>(
    editing ? { year_label: editing.year_label, start_date: editing.start_date ?? '', end_date: editing.end_date ?? '', is_active: editing.is_active } : blank
  );
  const [err, setErr] = useState('');

  const mut = useMutation({
    mutationFn: (b: any) => editing ? api.patch(`/masterdata/academic-years/${editing.year_id}`, b) : api.post('/masterdata/academic-years', b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['academic-years'] }); onClose(); },
    onError: (e: any) => setErr(e?.error?.message ?? 'Save failed'),
  });
  if (!open) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const b: any = { year_label: form.year_label, is_active: form.is_active };
    if (form.start_date) b.start_date = form.start_date;
    if (form.end_date) b.end_date = form.end_date;
    mut.mutate(b);
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Academic Year' : 'Add Academic Year'} size="sm">
      <form onSubmit={submit} className="space-y-4">
        <div><label className="label">Year Label</label>
          <input className="input" value={form.year_label} onChange={e => setForm(p => ({ ...p, year_label: e.target.value }))} required placeholder="e.g. 2024-25" disabled={!!editing} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Start Date</label><input type="date" className="input" value={form.start_date} onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))} /></div>
          <div><label className="label">End Date</label><input type="date" className="input" value={form.end_date} onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))} /></div>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="ya" checked={!!form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked ? 1 : 0 }))} />
          <label htmlFor="ya" className="text-sm text-gray-700">Active</label>
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

// ── Term Modal ─────────────────────────────────────────────────────────────────
function TermModal({ open, onClose, editing, years }: { open: boolean; onClose: () => void; editing: Term | null; years: AcademicYear[] }) {
  const qc = useQueryClient();
  const blank = { year_id: years[0]?.year_id ?? 0, term_name: '', parity: 'ODD' as 'ODD' | 'EVEN', start_date: '', end_date: '', status: 'DRAFT' };
  const [form, setForm] = useState(
    editing ? { year_id: editing.year_id, term_name: editing.term_name, parity: editing.parity, start_date: editing.start_date ?? '', end_date: editing.end_date ?? '', status: editing.status } : { ...blank, year_id: years[0]?.year_id ?? 0 }
  );
  const [err, setErr] = useState('');

  const mut = useMutation({
    mutationFn: (b: any) => editing ? api.patch(`/masterdata/terms/${editing.term_id}`, b) : api.post('/masterdata/terms', b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['terms'] }); onClose(); },
    onError: (e: any) => setErr(e?.error?.message ?? 'Save failed'),
  });
  if (!open) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (!form.start_date || !form.end_date) { setErr('Both term dates are required.'); return; }
    if (form.end_date < form.start_date) { setErr('End date must be on or after the start date.'); return; }
    const b: any = { term_name: form.term_name, parity: form.parity, status: form.status };
    if (!editing) b.year_id = form.year_id;
    b.start_date = form.start_date;
    b.end_date = form.end_date;
    mut.mutate(b);
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Term' : 'Add Term'} size="sm">
      <form onSubmit={submit} className="space-y-4">
        {!editing && <div><label className="label">Academic Year</label>
          <select className="input" value={form.year_id} onChange={e => setForm(p => ({ ...p, year_id: +e.target.value }))} required>
            {years.map(y => <option key={y.year_id} value={y.year_id}>{y.year_label}</option>)}
          </select></div>}
        <div><label className="label">Term Name</label>
          <input className="input" value={form.term_name} onChange={e => setForm(p => ({ ...p, term_name: e.target.value }))} required placeholder="e.g. Odd Semester 2024" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Parity</label>
            <select className="input" value={form.parity} onChange={e => setForm(p => ({ ...p, parity: e.target.value as any }))} disabled={!!editing}>
              <option value="ODD">ODD</option><option value="EVEN">EVEN</option>
            </select></div>
          <div><label className="label">Status</label>
            <select className="input" value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
              <option value="DRAFT">Draft</option><option value="ACTIVE">Active</option><option value="CLOSED">Archived</option>
            </select></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Start Date</label><input type="date" className="input" value={form.start_date} onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))} required /></div>
          <div><label className="label">End Date</label><input type="date" className="input" value={form.end_date} onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))} min={form.start_date || undefined} required /></div>
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

function TermSemesterModal({
  open, onClose, editing, terms, programs, schemes, semesters,
}: {
  open: boolean; onClose: () => void; editing: TermProgramSemester | null;
  terms: Term[]; programs: Program[]; schemes: Scheme[]; semesters: Semester[];
}) {
  const qc = useQueryClient();
  const initialSemester = editing ? semesters.find(s => s.semester_id === editing.semester_id) : undefined;
  const initialScheme = initialSemester ? schemes.find(s => s.scheme_id === initialSemester.scheme_id) : schemes.find(s => s.is_active);
  const [form, setForm] = useState({
    term_id: editing?.term_id ?? terms.find(t => t.status !== 'CLOSED')?.term_id ?? 0,
    program_id: initialScheme?.program_id ?? programs.find(p => p.is_active)?.program_id ?? 0,
    scheme_id: initialScheme?.scheme_id ?? 0,
    semester_id: editing?.semester_id ?? 0,
    is_active: editing?.is_active ?? 1,
  });
  const [err, setErr] = useState('');
  const [mappingMessage, setMappingMessage] = useState('');
  const eligibleSchemes = schemes.filter(s => s.program_id === form.program_id && s.is_active);
  const availableTerms = terms.filter(t => t.status !== 'CLOSED');
  const availablePrograms = programs.filter(p => p.is_active);
  const termParity = terms.find(t => t.term_id === form.term_id)?.parity;
  const paritySemesters = semestersForParity(termParity);
  const eligibleSemesters = semesters.filter(s =>
    s.scheme_id === form.scheme_id && s.is_active && paritySemesters.includes(s.semester_no),
  );

  const mut = useMutation({
    mutationFn: (body: Record<string, number>) => editing
      ? api.patch(`/masterdata/term-program-semesters/${editing.term_program_semester_id}`, { is_active: body.is_active })
      : api.post('/masterdata/term-program-semesters', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['term-program-semesters'] });
      qc.invalidateQueries({ queryKey: ['sections'] });
      onClose();
    },
    onError: (e: any) => setErr(e?.error?.message ?? 'Save failed'),
  });
  const mapParityMutation = useMutation({
    mutationFn: () => api.post<{
      created_count: number;
      eligible_count: number;
      active_semesters: number[];
      inactive_semesters: number[];
    }>('/masterdata/term-program-semesters/map-parity', {
      term_id: form.term_id,
      program_id: form.program_id,
    }),
    onSuccess: result => {
      qc.invalidateQueries({ queryKey: ['term-program-semesters'] });
      qc.invalidateQueries({ queryKey: ['curriculum-builder-mappings'] });
      setErr('');
      setMappingMessage(result.eligible_count
        ? `Added ${result.created_count} mapping(s). Active mapped semesters: ${result.active_semesters.join(', ') || 'none'}.${result.inactive_semesters.length ? ` Inactive mappings were left unchanged: ${result.inactive_semesters.join(', ')}.` : ''}`
        : `No active semester records for the ${termParity?.toLowerCase() ?? 'selected'} parity exist in this program. Add the institutionally configured semester records first.`);
    },
    onError: (error: any) => setErr(error?.error?.message ?? 'Unable to map existing parity semesters.'),
  });

  if (!open) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (!editing && (!form.term_id || !form.semester_id)) {
      setErr('Select a term and semester.');
      return;
    }
    mut.mutate(editing ? { is_active: form.is_active } : { term_id: form.term_id, semester_id: form.semester_id });
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Term Semester' : 'Configure Term Semester'} size="sm">
      <form onSubmit={submit} className="space-y-4">
        {!editing && <>
          <div><label className="label">Academic Term</label>
            <select className="input" value={form.term_id} onChange={e => {
              setForm(p => ({ ...p, term_id: +e.target.value, semester_id: 0 }));
              setMappingMessage('');
            }} required>
              {availableTerms.map(t => <option key={t.term_id} value={t.term_id}>{t.term_name}</option>)}
            </select></div>
          <div><label className="label">Program</label>
            <select className="input" value={form.program_id} onChange={e => {
              const program_id = +e.target.value;
              const scheme = schemes.find(s => s.program_id === program_id && s.is_active);
              setForm(p => ({ ...p, program_id, scheme_id: scheme?.scheme_id ?? 0, semester_id: 0 }));
            }} required>
              {availablePrograms.map(p => <option key={p.program_id} value={p.program_id}>{p.program_name}</option>)}
            </select></div>
          <div><label className="label">Curriculum Scheme</label>
            <select className="input" value={form.scheme_id} onChange={e => setForm(p => ({ ...p, scheme_id: +e.target.value, semester_id: 0 }))} required>
              {eligibleSchemes.map(s => <option key={s.scheme_id} value={s.scheme_id}>{s.scheme_code} v{s.version ?? '1'}</option>)}
            </select></div>
          <div><label className="label">Semester</label>
            <select className="input" value={form.semester_id} onChange={e => setForm(p => ({ ...p, semester_id: +e.target.value }))} required>
              <option value={0}>Select a configured semester</option>
              {eligibleSemesters.map(s => <option key={s.semester_id} value={s.semester_id}>
                Semester {s.semester_no}{s.name ? ` — ${s.name}` : ''}
              </option>)}
            </select></div>
          <p className="text-xs text-gray-500">Only active semester records matching this term’s parity can be configured. Create missing semester records in the scheme first; this mapping will not invent them.</p>
          <div className="rounded-md border border-blue-100 bg-blue-50 p-3">
            <p className="text-xs text-blue-900">
              {termParity
                ? `${termParity} terms use semesters ${paritySemesters.join(', ')}. This action maps only existing active semester records; it does not create semesters or reactivate inactive mappings.`
                : 'Select a term to see its parity semesters.'}
            </p>
            {mappingMessage && <p className="mt-2 text-xs text-blue-900" role="status">{mappingMessage}</p>}
            <button
              type="button"
              className="btn-secondary btn-sm mt-3"
              disabled={!form.term_id || !form.program_id || mapParityMutation.isPending}
              onClick={() => mapParityMutation.mutate()}
            >
              {mapParityMutation.isPending ? 'Mapping…' : `Map existing ${termParity ?? ''} semesters`}
            </button>
          </div>
        </>}
        {editing && <div className="flex items-center gap-2">
          <input type="checkbox" id="tps-active" checked={!!form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked ? 1 : 0 }))} />
          <label htmlFor="tps-active" className="text-sm">Active for new divisions</label>
        </div>}
        {err && <FormError message={err} />}
        <div className="flex justify-end gap-3 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={mut.isPending || (!editing && (!eligibleSchemes.length || !eligibleSemesters.length))}>
            {mut.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Program Modal ─────────────────────────────────────────────────────────────
function ProgramModal({ open, onClose, editing, depts }: { open: boolean; onClose: () => void; editing: Program | null; depts: Department[] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(
    editing
      ? { dept_id: editing.dept_id, program_code: editing.program_code, program_name: editing.program_name, is_active: editing.is_active }
      : { dept_id: depts[0]?.dept_id ?? 0, program_code: '', program_name: '', is_active: 1 }
  );
  const [err, setErr] = useState('');

  const mut = useMutation({
    mutationFn: (b: any) => editing ? api.patch(`/masterdata/programs/${editing.program_id}`, b) : api.post('/masterdata/programs', b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['programs'] }); onClose(); },
    onError: (e: any) => setErr(e?.error?.message ?? 'Save failed'),
  });

  if (!open) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const b: any = { program_name: form.program_name, is_active: form.is_active };
    if (!editing) { b.dept_id = form.dept_id; b.program_code = form.program_code; }
    mut.mutate(b);
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Program' : 'Add Program'} size="sm">
      <form onSubmit={submit} className="space-y-4">
        {!editing && <div><label className="label">Department</label>
          <select className="input" value={form.dept_id} onChange={e => setForm(p => ({ ...p, dept_id: +e.target.value }))} required>
            {depts.map(d => <option key={d.dept_id} value={d.dept_id}>{d.dept_name}</option>)}
          </select></div>}
        <div><label className="label">Program Code</label>
          <input className="input" value={form.program_code} onChange={e => setForm(p => ({ ...p, program_code: e.target.value }))} required placeholder="e.g. BTECH_CSE" disabled={!!editing} /></div>
        <div><label className="label">Program Name</label>
          <input className="input" value={form.program_name} onChange={e => setForm(p => ({ ...p, program_name: e.target.value }))} required placeholder="e.g. B.Tech Computer Science" /></div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="pa" checked={!!form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked ? 1 : 0 }))} />
          <label htmlFor="pa" className="text-sm">Active</label>
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

// ── Scheme Modal ──────────────────────────────────────────────────────────────
function SchemeModal({ open, onClose, editing, programs }: { open: boolean; onClose: () => void; editing: Scheme | null; programs: Program[] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(
    editing
      ? { program_id: editing.program_id, scheme_code: editing.scheme_code, version: editing.version ?? '1', is_active: editing.is_active }
      : { program_id: programs[0]?.program_id ?? 0, scheme_code: '', version: '1', is_active: 1 }
  );
  const [err, setErr] = useState('');

  const mut = useMutation({
    mutationFn: (b: any) => editing ? api.patch(`/masterdata/schemes/${editing.scheme_id}`, b) : api.post('/masterdata/schemes', b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['schemes'] }); onClose(); },
    onError: (e: any) => setErr(e?.error?.message ?? 'Save failed'),
  });

  if (!open) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const b: any = { scheme_code: form.scheme_code, version: form.version, is_active: form.is_active };
    if (!editing) b.program_id = form.program_id;
    mut.mutate(b);
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Scheme' : 'Add Scheme'} size="sm">
      <form onSubmit={submit} className="space-y-4">
        {!editing && <div><label className="label">Program</label>
          <select className="input" value={form.program_id} onChange={e => setForm(p => ({ ...p, program_id: +e.target.value }))} required>
            {programs.map(p => <option key={p.program_id} value={p.program_id}>{p.program_name}</option>)}
          </select></div>}
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Scheme Code</label>
            <input className="input" value={form.scheme_code} onChange={e => setForm(p => ({ ...p, scheme_code: e.target.value }))} required placeholder="e.g. 2021" /></div>
          <div><label className="label">Version</label>
            <input className="input" value={form.version} onChange={e => setForm(p => ({ ...p, version: e.target.value }))} placeholder="1" /></div>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="sca" checked={!!form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked ? 1 : 0 }))} />
          <label htmlFor="sca" className="text-sm">Active</label>
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

// ── Semester Modal ────────────────────────────────────────────────────────────
function SemesterModal({ open, onClose, editing, schemes }: { open: boolean; onClose: () => void; editing: Semester | null; schemes: Scheme[] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(
    editing
      ? { scheme_id: editing.scheme_id, semester_no: editing.semester_no, name: editing.name ?? '', is_active: editing.is_active }
      : { scheme_id: schemes[0]?.scheme_id ?? 0, semester_no: 1, name: '', is_active: 1 }
  );
  const [err, setErr] = useState('');

  const mut = useMutation({
    mutationFn: (b: any) => editing ? api.patch(`/masterdata/semesters/${editing.semester_id}`, b) : api.post('/masterdata/semesters', b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['semesters'] }); onClose(); },
    onError: (e: any) => setErr(e?.error?.message ?? 'Save failed'),
  });

  if (!open) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const b: any = { name: form.name || undefined, is_active: form.is_active };
    if (!editing) { b.scheme_id = form.scheme_id; b.semester_no = form.semester_no; }
    mut.mutate(b);
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Semester' : 'Add Semester'} size="sm">
      <form onSubmit={submit} className="space-y-4">
        {!editing && <>
          <div><label className="label">Scheme</label>
            <select className="input" value={form.scheme_id} onChange={e => setForm(p => ({ ...p, scheme_id: +e.target.value }))} required>
              {schemes.map(s => <option key={s.scheme_id} value={s.scheme_id}>{s.scheme_code} v{s.version ?? '1'}</option>)}
            </select></div>
          <div><label className="label">Semester No. (1–12)</label>
            <input type="number" className="input" min={1} max={12} value={form.semester_no} onChange={e => setForm(p => ({ ...p, semester_no: +e.target.value }))} required /></div>
        </>}
        <div><label className="label">Name (optional)</label>
          <input className="input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Semester I" /></div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="sema" checked={!!form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked ? 1 : 0 }))} />
          <label htmlFor="sema" className="text-sm">Active</label>
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

// ── Section Modal ─────────────────────────────────────────────────────────────
function SectionModal({
  open, onClose, editing, terms, semesters, configurations, schemes, programs,
}: {
  open: boolean; onClose: () => void; editing: Section | null; terms: Term[]; semesters: Semester[];
  configurations: TermProgramSemester[]; schemes: Scheme[]; programs: Program[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState(
    editing
      ? { term_id: editing.term_id, semester_id: editing.semester_id, section_name: editing.section_name, strength: editing.strength != null ? String(editing.strength) : '', data_status: editing.data_status, is_active: editing.is_active }
      : { term_id: terms[0]?.term_id ?? 0, semester_id: 0, section_name: '', strength: '', data_status: 'VERIFY', is_active: 1 }
  );
  const [err, setErr] = useState('');
  const available = configurations.filter(c => c.term_id === form.term_id && c.is_active);
  const semesterOptions = semesters.filter(s => available.some(c => c.semester_id === s.semester_id));

  const contextLabel = (semesterId: number) => {
    const semester = semesters.find(s => s.semester_id === semesterId);
    const scheme = schemes.find(s => s.scheme_id === semester?.scheme_id);
    const program = programs.find(p => p.program_id === scheme?.program_id);
    return `${program?.program_name ?? 'Program'} · ${scheme?.scheme_code ?? 'Scheme'} · Semester ${semester?.semester_no ?? ''}`;
  };

  const mut = useMutation({
    mutationFn: (b: any) => editing ? api.patch(`/masterdata/sections/${editing.section_id}`, b) : api.post('/masterdata/sections', b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sections'] }); qc.invalidateQueries({ queryKey: ['batches'] }); onClose(); },
    onError: (e: any) => setErr(e?.error?.message ?? 'Save failed'),
  });

  if (!open) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const b: any = { section_name: form.section_name, data_status: form.data_status, is_active: form.is_active };
    if (form.strength !== '') b.strength = +form.strength;
    if (!editing) { b.term_id = form.term_id; b.semester_id = form.semester_id; }
    if (!form.semester_id) { setErr('Configure a program semester for this term before adding a division.'); return; }
    mut.mutate(b);
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Division' : 'Add Division'} size="sm">
      <form onSubmit={submit} className="space-y-4">
        {!editing && <>
          <div><label className="label">Term</label>
            <select className="input" value={form.term_id} onChange={e => {
              const term_id = +e.target.value;
              const configuration = configurations.find(c => c.term_id === term_id && c.is_active);
              setForm(p => ({ ...p, term_id, semester_id: configuration?.semester_id ?? 0 }));
            }} required>
              {terms.filter(t => t.status !== 'CLOSED').map(t => <option key={t.term_id} value={t.term_id}>{t.term_name}</option>)}
            </select></div>
          <div><label className="label">Program / Semester (configured for this term)</label>
            <select className="input" value={form.semester_id} onChange={e => setForm(p => ({ ...p, semester_id: +e.target.value }))} required>
              <option value={0}>Select configured program semester</option>
              {semesterOptions.map(s => <option key={s.semester_id} value={s.semester_id}>{contextLabel(s.semester_id)}</option>)}
            </select></div>
        </>}
        {editing && <p className="text-sm text-gray-600">{terms.find(t => t.term_id === editing.term_id)?.term_name ?? 'Term'} · {contextLabel(editing.semester_id)}</p>}
        <div><label className="label">Division Name / Code</label>
          <input className="input" value={form.section_name} onChange={e => setForm(p => ({ ...p, section_name: e.target.value }))} required placeholder="Configured division code" /></div>
        <div><label className="label">Strength (optional)</label>
          <input type="number" className="input" min={1} value={form.strength} onChange={e => setForm(p => ({ ...p, strength: e.target.value }))} placeholder="Student count" /></div>
        <div><label className="label">Data Status</label>
          <select className="input" value={form.data_status} onChange={e => setForm(p => ({ ...p, data_status: e.target.value }))}>
            {['VERIFIED', 'VERIFY', 'DISCREPANCY', 'SYNTHETIC'].map(s => <option key={s} value={s}>{s}</option>)}
          </select></div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="division-active" checked={!!form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked ? 1 : 0 }))} />
          <label htmlFor="division-active" className="text-sm">Active</label>
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

// ── Batch Modal ───────────────────────────────────────────────────────────────
function BatchModal({ open, onClose, editing, sections }: { open: boolean; onClose: () => void; editing: Batch | null; sections: Section[] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(
    editing
      ? { section_id: editing.section_id, batch_name: editing.batch_name, batch_type: editing.batch_type as string, strength: editing.strength != null ? String(editing.strength) : '', is_active: editing.is_active }
      : { section_id: sections[0]?.section_id ?? 0, batch_name: '', batch_type: 'LAB', strength: '', is_active: 1 }
  );
  const [err, setErr] = useState('');

  const mut = useMutation({
    mutationFn: (b: any) => editing ? api.patch(`/masterdata/batches/${editing.batch_id}`, b) : api.post('/masterdata/batches', b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['batches'] }); onClose(); },
    onError: (e: any) => setErr(e?.error?.message ?? 'Save failed'),
  });

  if (!open) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const b: any = { batch_name: form.batch_name, batch_type: form.batch_type, is_active: form.is_active };
    if (form.strength !== '') b.strength = +form.strength;
    if (!editing) b.section_id = form.section_id;
    mut.mutate(b);
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Batch' : 'Add Batch'} size="sm">
      <form onSubmit={submit} className="space-y-4">
        {!editing && <div><label className="label">Parent Division</label>
          <select className="input" value={form.section_id} onChange={e => setForm(p => ({ ...p, section_id: +e.target.value }))} required>
            {sections.filter(s => s.is_active).map(s => <option key={s.section_id} value={s.section_id}>{s.section_name} (ID {s.section_id})</option>)}
          </select></div>}
        <div><label className="label">Lab Batch Name</label>
          <input className="input" value={form.batch_name} onChange={e => setForm(p => ({ ...p, batch_name: e.target.value }))} required placeholder="Batch name or code" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Type</label>
            <select className="input" value={form.batch_type} onChange={e => setForm(p => ({ ...p, batch_type: e.target.value }))}>
              {['LAB', 'TUTORIAL', 'ELECTIVE', 'OTHER'].map(t => <option key={t} value={t}>{t}</option>)}
            </select></div>
          <div><label className="label">Strength</label>
            <input type="number" className="input" min={1} value={form.strength} onChange={e => setForm(p => ({ ...p, strength: e.target.value }))} placeholder="optional" /></div>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="ba" checked={!!form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked ? 1 : 0 }))} />
          <label htmlFor="ba" className="text-sm">Active</label>
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

// ── Main Page ─────────────────────────────────────────────────────────────────
export function AcademicStructurePage() {
  const [tab, setTab] = useState<Tab>('years');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const { data: years = [], isLoading: lY, error: eY } = useQuery({ queryKey: ['academic-years'], queryFn: () => listRequest<AcademicYear>('/masterdata/academic-years?limit=500'), select: r => r.data });
  const { data: terms = [], isLoading: lT, error: eT } = useQuery({ queryKey: ['terms'], queryFn: () => listRequest<Term>('/masterdata/terms?limit=500'), select: r => r.data });
  const { data: departments = [] } = useQuery({ queryKey: ['departments'], queryFn: () => listRequest<Department>('/masterdata/departments?limit=500'), select: r => r.data });
  const { data: programs = [], isLoading: lP, error: eP } = useQuery({ queryKey: ['programs'], queryFn: () => listRequest<Program>('/masterdata/programs?limit=500'), select: r => r.data });
  const { data: schemes = [], isLoading: lSc, error: eSc } = useQuery({ queryKey: ['schemes'], queryFn: () => listRequest<Scheme>('/masterdata/schemes?limit=500'), select: r => r.data });
  const { data: semesters = [], isLoading: lSem, error: eSem } = useQuery({ queryKey: ['semesters'], queryFn: () => listRequest<Semester>('/masterdata/semesters?limit=500'), select: r => r.data });
  const { data: termSemesters = [], isLoading: lTS, error: eTS } = useQuery({ queryKey: ['term-program-semesters'], queryFn: () => listRequest<TermProgramSemester>('/masterdata/term-program-semesters?limit=500'), select: r => r.data });
  const { data: sections = [], isLoading: lSec, error: eSec } = useQuery({ queryKey: ['sections'], queryFn: () => listRequest<Section>('/masterdata/sections?limit=500'), select: r => r.data });
  const { data: batches = [], isLoading: lB, error: eB } = useQuery({ queryKey: ['batches'], queryFn: () => listRequest<Batch>('/masterdata/batches?limit=500'), select: r => r.data });

  const yearMap = Object.fromEntries(years.map(y => [y.year_id, y.year_label]));
  const deptMap = Object.fromEntries(departments.map(d => [d.dept_id, d.dept_name]));
  const programMap = Object.fromEntries(programs.map(p => [p.program_id, p.program_name]));
  const schemeMap = Object.fromEntries(schemes.map(s => [s.scheme_id, `${s.scheme_code} v${s.version ?? '1'}`]));
  const semesterMap = Object.fromEntries(semesters.map(s => [s.semester_id, `Sem ${s.semester_no}${s.name ? ` – ${s.name}` : ''}`]));
  const sectionMap = Object.fromEntries(sections.map(s => [s.section_id, `${s.section_name} · ${terms.find(t => t.term_id === s.term_id)?.term_name ?? 'Term'} · ${semesterMap[s.semester_id] ?? s.semester_id}`]));

  const error = eY || eT || eP || eSc || eSem || eTS || eSec || eB;
  if (error) return <ErrorMessage error={error} />;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'years', label: 'Academic Years' },
    { key: 'terms', label: 'Terms' },
    { key: 'programs', label: 'Programs' },
    { key: 'schemes', label: 'Schemes' },
    { key: 'semesters', label: 'Semesters' },
    { key: 'termSemesters', label: 'Term Semesters' },
    { key: 'sections', label: 'Divisions' },
    { key: 'batches', label: 'Lab Batches' },
  ];

  const tabConfig: Record<Tab, { label: string }> = {
    years:     { label: 'Academic Year' },
    terms:     { label: 'Term' },
    programs:  { label: 'Program' },
    schemes:   { label: 'Scheme' },
    semesters: { label: 'Semester' },
    termSemesters: { label: 'Term Semester' },
    sections:  { label: 'Division' },
    batches:   { label: 'Lab Batch' },
  };

  // Key-remount trick: changing key forces modal to remount with fresh state
  function openCreate() { setEditing(null); setShowForm(true); }
  function openEdit(row: any) { setEditing(row); setShowForm(true); }
  const actionCol = (row: any, idKey: string, labelKey: string) => (
    <div className="flex gap-1">
      <button className="btn-ghost btn-sm" aria-label={`Edit ${String(row[labelKey])}`} onClick={() => openEdit(row)}><PencilIcon className="w-3.5 h-3.5" /></button>
    </div>
  );

  // Unique key forces full remount (fresh useState) each time a modal opens
  const modalKey = `${tab}-${editing ? editing[Object.keys(editing)[0]] : 'new'}-${showForm}`;

  return (
    <div>
      <PageHeader title="Academic Structure"
        subtitle="Manage academic years, terms, program semesters, divisions and lab batches."
        actions={<button className="btn-primary btn-sm" onClick={openCreate}><PlusIcon className="w-4 h-4" /> Add {tabConfig[tab].label}</button>} />

      <div className="flex gap-1 mb-5 border-b border-gray-200 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setShowForm(false); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${tab === t.key ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'years' && <DataTable<AcademicYear> columns={[
        { header: 'Label', accessor: 'year_label' },
        { header: 'Start', accessor: y => y.start_date ?? '—' },
        { header: 'End', accessor: y => y.end_date ?? '—' },
        { header: 'Status', accessor: y => <Badge variant={y.is_active ? 'green' : 'gray'}>{y.is_active ? 'Active' : 'Inactive'}</Badge> },
        { header: '', accessor: y => actionCol(y, 'year_id', 'year_label') },
      ]} data={years} keyField="year_id" loading={lY} emptyTitle="No academic years" />}

      {tab === 'terms' && <DataTable<Term> columns={[
        { header: 'Term', accessor: 'term_name' },
        { header: 'Year', accessor: t => yearMap[t.year_id] ?? t.year_id },
        { header: 'Parity', accessor: t => <Badge variant={t.parity === 'ODD' ? 'blue' : 'purple'}>{t.parity}</Badge> },
        { header: 'Start', accessor: t => t.start_date ?? '—' },
        { header: 'End', accessor: t => t.end_date ?? '—' },
        { header: 'Status', accessor: t => <Badge variant={t.status === 'ACTIVE' ? 'green' : t.status === 'DRAFT' ? 'yellow' : 'gray'}>{t.status === 'CLOSED' ? 'Archived' : t.status === 'ACTIVE' ? 'Active' : 'Draft'}</Badge> },
        { header: '', accessor: t => actionCol(t, 'term_id', 'term_name') },
      ]} data={terms} keyField="term_id" loading={lT} emptyTitle="No terms" />}

      {tab === 'programs' && <DataTable<Program> columns={[
        { header: 'Code', accessor: 'program_code' },
        { header: 'Name', accessor: 'program_name' },
        { header: 'Department', accessor: p => deptMap[p.dept_id] ?? p.dept_id },
        { header: 'Status', accessor: p => <Badge variant={p.is_active ? 'green' : 'gray'}>{p.is_active ? 'Active' : 'Inactive'}</Badge> },
        { header: '', accessor: p => actionCol(p, 'program_id', 'program_name') },
      ]} data={programs} keyField="program_id" loading={lP} emptyTitle="No programs" />}

      {tab === 'schemes' && <DataTable<Scheme> columns={[
        { header: 'Code', accessor: 'scheme_code' },
        { header: 'Version', accessor: s => s.version ?? '1' },
        { header: 'Program', accessor: s => programMap[s.program_id] ?? s.program_id },
        { header: 'Status', accessor: s => <Badge variant={s.is_active ? 'green' : 'gray'}>{s.is_active ? 'Active' : 'Inactive'}</Badge> },
        { header: '', accessor: s => actionCol(s, 'scheme_id', 'scheme_code') },
      ]} data={schemes} keyField="scheme_id" loading={lSc} emptyTitle="No schemes" />}

      {tab === 'semesters' && <DataTable<Semester> columns={[
        { header: 'Sem No', accessor: 'semester_no' },
        { header: 'Name', accessor: s => s.name ?? '—' },
        { header: 'Scheme', accessor: s => schemeMap[s.scheme_id] ?? s.scheme_id },
        { header: 'Status', accessor: s => <Badge variant={s.is_active ? 'green' : 'gray'}>{s.is_active ? 'Active' : 'Inactive'}</Badge> },
        { header: '', accessor: s => actionCol(s, 'semester_id', 'semester_no') },
      ]} data={semesters} keyField="semester_id" loading={lSem} emptyTitle="No semesters" />}

      {tab === 'termSemesters' && <DataTable<TermProgramSemester> columns={[
        { header: 'Term', accessor: row => terms.find(t => t.term_id === row.term_id)?.term_name ?? row.term_id },
        { header: 'Program', accessor: row => {
          const scheme = schemes.find(s => s.scheme_id === row.scheme_id);
          return programMap[scheme?.program_id ?? 0] ?? row.scheme_id;
        } },
        { header: 'Scheme', accessor: row => schemeMap[row.scheme_id] ?? row.scheme_id },
        { header: 'Semester', accessor: row => semesterMap[row.semester_id] ?? row.semester_id },
        { header: 'Status', accessor: row => <Badge variant={row.is_active ? 'green' : 'gray'}>{row.is_active ? 'Active' : 'Inactive'}</Badge> },
        { header: '', accessor: row => actionCol(row, 'term_program_semester_id', 'semester_id') },
      ]} data={termSemesters} keyField="term_program_semester_id" loading={lTS} emptyTitle="No program semesters configured for terms" />}

      {tab === 'sections' && <DataTable<Section> columns={[
        { header: 'Division', accessor: 'section_name' },
        { header: 'Term', accessor: s => terms.find(t => t.term_id === s.term_id)?.term_name ?? s.term_id },
        { header: 'Program', accessor: s => {
          const scheme = schemes.find(row => row.scheme_id === s.scheme_id);
          return programMap[scheme?.program_id ?? 0] ?? s.scheme_id;
        } },
        { header: 'Semester', accessor: s => semesterMap[s.semester_id] ?? s.semester_id },
        { header: 'Strength', accessor: s => s.strength ?? '—' },
        { header: 'Active', accessor: s => <Badge variant={s.is_active ? 'green' : 'gray'}>{s.is_active ? 'Active' : 'Inactive'}</Badge> },
        { header: 'Data Status', accessor: s => <StatusBadge status={s.data_status} /> },
        { header: '', accessor: s => actionCol(s, 'section_id', 'section_name') },
      ]} data={sections} keyField="section_id" loading={lSec} emptyTitle="No divisions" />}

      {tab === 'batches' && <DataTable<Batch> columns={[
        { header: 'Lab Batch', accessor: 'batch_name' },
        { header: 'Parent Division', accessor: b => sectionMap[b.section_id] ?? b.section_id },
        { header: 'Type', accessor: b => <Badge variant="blue">{b.batch_type}</Badge> },
        { header: 'Strength', accessor: b => b.strength ?? '—' },
        { header: 'Status', accessor: b => <Badge variant={b.is_active ? 'green' : 'gray'}>{b.is_active ? 'Active' : 'Inactive'}</Badge> },
        { header: '', accessor: b => actionCol(b, 'batch_id', 'batch_name') },
      ]} data={batches} keyField="batch_id" loading={lB} emptyTitle="No batches" />}

      {/* Modals — key forces remount with fresh state each open */}
      {tab === 'years'     && <YearModal     key={modalKey} open={showForm} onClose={() => setShowForm(false)} editing={editing} />}
      {tab === 'terms'     && <TermModal     key={modalKey} open={showForm} onClose={() => setShowForm(false)} editing={editing} years={years} />}
      {tab === 'programs'  && <ProgramModal  key={modalKey} open={showForm} onClose={() => setShowForm(false)} editing={editing} depts={departments} />}
      {tab === 'schemes'   && <SchemeModal   key={modalKey} open={showForm} onClose={() => setShowForm(false)} editing={editing} programs={programs} />}
      {tab === 'semesters' && <SemesterModal key={modalKey} open={showForm} onClose={() => setShowForm(false)} editing={editing} schemes={schemes} />}
      {tab === 'termSemesters' && <TermSemesterModal key={modalKey} open={showForm} onClose={() => setShowForm(false)} editing={editing} terms={terms} programs={programs} schemes={schemes} semesters={semesters} />}
      {tab === 'sections'  && <SectionModal  key={modalKey} open={showForm} onClose={() => setShowForm(false)} editing={editing} terms={terms} semesters={semesters} configurations={termSemesters} schemes={schemes} programs={programs} />}
      {tab === 'batches'   && <BatchModal    key={modalKey} open={showForm} onClose={() => setShowForm(false)} editing={editing} sections={sections} />}
    </div>
  );
}
