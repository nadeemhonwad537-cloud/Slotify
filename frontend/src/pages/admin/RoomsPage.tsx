


import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PlusIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { api, listRequest } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Modal, ConfirmModal } from '@/components/ui/Modal';
import { ErrorMessage, FormError } from '@/components/ui/ErrorMessage';
import type { AvailabilityType, Room, RoomAvailability, RoomType, TeachingDay, TimeSlot, Term } from '@/types';

type Tab = 'rooms' | 'room-types' | 'availability' | 'slots' | 'days';

const DATA_STATUSES = ['VERIFIED', 'VERIFY', 'DISCREPANCY', 'RESOLVED', 'SYNTHETIC'] as const;
const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
const SLOT_TYPES = ['TEACHING', 'BREAK', 'LUNCH'] as const;
const AVAILABILITY_TYPES: AvailabilityType[] = ['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN'];

// ── Room Type Modal ───────────────────────────────────────────────────────────
function RoomTypeModal({ open, onClose, editing }: { open: boolean; onClose: () => void; editing: RoomType | null }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(
    editing
      ? { type_code: editing.type_code, type_name: editing.type_name, description: editing.description ?? '', is_active: editing.is_active }
      : { type_code: '', type_name: '', description: '', is_active: 1 }
  );
  const [err, setErr] = useState('');

  const mut = useMutation({
    mutationFn: (b: any) => editing ? api.patch(`/masterdata/room-types/${editing.room_type_id}`, b) : api.post('/masterdata/room-types', b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['room-types'] }); onClose(); },
    onError: (e: any) => setErr(e?.error?.message ?? 'Save failed'),
  });

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Room Type' : 'Add Room Type'} size="sm">
      <form onSubmit={e => {
        e.preventDefault(); setErr('');
        const b: any = { type_name: form.type_name, is_active: form.is_active };
        if (!editing) b.type_code = form.type_code.toUpperCase();
        if (form.description.trim()) b.description = form.description.trim();
        mut.mutate(b);
      }} className="space-y-4">
        <div><label className="label">Type Code</label>
          <input className="input" value={form.type_code} onChange={e => setForm(p => ({ ...p, type_code: e.target.value.toUpperCase() }))} required placeholder="e.g. SEMINAR" disabled={!!editing} /></div>
        <div><label className="label">Type Name</label>
          <input className="input" value={form.type_name} onChange={e => setForm(p => ({ ...p, type_name: e.target.value }))} required placeholder="e.g. Seminar Hall" /></div>
        <div><label className="label">Description (optional)</label>
          <input className="input" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} /></div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="rta" checked={!!form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked ? 1 : 0 }))} />
          <label htmlFor="rta" className="text-sm">Active</label>
        </div>
        {err && <FormError message={err} />}
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={mut.isPending}>{mut.isPending ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Room Modal ────────────────────────────────────────────────────────────────
function RoomModal({ open, onClose, onSaved, editing, roomTypes }: { open: boolean; onClose: () => void; onSaved: (message: string) => void; editing: Room | null; roomTypes: RoomType[] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(
    editing
      ? { room_code: editing.room_code, room_name: editing.room_name ?? '', room_type_id: editing.room_type_id, capacity: editing.capacity != null ? String(editing.capacity) : '', equipment: editing.equipment ?? '', location: editing.location ?? '', practical_approved: editing.practical_approved, data_status: editing.data_status, is_active: editing.is_active }
      : { room_code: '', room_name: '', room_type_id: roomTypes.find(r => r.is_active)?.room_type_id ?? 0, capacity: '', equipment: '', location: '', practical_approved: 0, data_status: 'VERIFY', is_active: 1 }
  );
  const [err, setErr] = useState('');

  const mut = useMutation({
    mutationFn: (b: any) => editing ? api.patch(`/masterdata/rooms/${editing.room_id}`, b) : api.post('/masterdata/rooms', b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rooms'] }); onSaved(editing ? 'Room updated.' : 'Room created.'); onClose(); },
    onError: (e: any) => setErr(e?.error?.message ?? 'Save failed'),
  });

  if (!open) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const b: any = {
      room_type_id: form.room_type_id, practical_approved: form.practical_approved, data_status: form.data_status, is_active: form.is_active,
      room_name: form.room_name.trim() || null,
      equipment: form.equipment.trim() || null,
      location: form.location.trim() || null,
    };
    if (!editing) b.room_code = form.room_code;
    b.capacity = form.capacity === '' ? null : +form.capacity;
    mut.mutate(b);
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Room' : 'Add Room'} size="md">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Room Code</label>
            <input className="input" value={form.room_code} onChange={e => setForm(p => ({ ...p, room_code: e.target.value }))} required placeholder="e.g. A101" disabled={!!editing} /></div>
          <div><label className="label">Room Name (optional)</label>
            <input className="input" value={form.room_name} onChange={e => setForm(p => ({ ...p, room_name: e.target.value }))} placeholder="e.g. Main Classroom A" /></div>
        </div>
        <div className="flex items-start gap-2">
          <input type="checkbox" id="room-practical-approved" checked={!!form.practical_approved}
            onChange={e => setForm(p => ({ ...p, practical_approved: e.target.checked ? 1 : 0 }))} />
          <label htmlFor="room-practical-approved" className="text-sm">
            Explicitly approved for practical classes
            <span className="block text-xs text-gray-500">Use only after institutional approval; the room must also have verified suitability data.</span>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Room Type</label>
            <select className="input" value={form.room_type_id} onChange={e => setForm(p => ({ ...p, room_type_id: +e.target.value }))} required>
              <option value="">Select room type</option>
              {roomTypes.filter(r => r.is_active || r.room_type_id === form.room_type_id).map(r => <option key={r.room_type_id} value={r.room_type_id}>{r.type_name}{r.is_active ? '' : ' (inactive)'}</option>)}
            </select></div>
          <div><label className="label">Capacity</label>
            <input type="number" className="input" min={1} value={form.capacity} onChange={e => setForm(p => ({ ...p, capacity: e.target.value }))} placeholder="e.g. 60" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Location (optional)</label>
            <input className="input" maxLength={120} value={form.location} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} placeholder="Building or campus location" /></div>
          <div><label className="label">Equipment / Features (optional)</label>
            <input className="input" maxLength={255} value={form.equipment} onChange={e => setForm(p => ({ ...p, equipment: e.target.value }))} placeholder="Projector, computers, etc." /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Data Status</label>
            <select className="input" value={form.data_status} onChange={e => setForm(p => ({ ...p, data_status: e.target.value }))}>
              {DATA_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select></div>
          <div className="flex items-center gap-2 pt-6">
            <input type="checkbox" id="ra" checked={!!form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked ? 1 : 0 }))} />
            <label htmlFor="ra" className="text-sm">Active</label>
          </div>
        </div>
        {err && <FormError message={err} />}
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={mut.isPending}>{mut.isPending ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

function RoomAvailabilityModal({ open, onClose, onSaved, editing, rooms, terms, selectedRoomId, selectedTermId }: {
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
  editing: RoomAvailability | null;
  rooms: Room[];
  terms: Term[];
  selectedRoomId: string;
  selectedTermId: string;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState(editing
    ? { room_id: String(editing.room_id), term_id: String(editing.term_id), day: editing.day, start_time: editing.start_time.slice(0, 5), end_time: editing.end_time.slice(0, 5), availability_type: editing.availability_type, data_status: editing.data_status }
    : { room_id: selectedRoomId, term_id: selectedTermId, day: 'MON', start_time: '', end_time: '', availability_type: 'UNKNOWN' as AvailabilityType, data_status: 'VERIFY' });
  const [err, setErr] = useState('');

  const mut = useMutation({
    mutationFn: (body: Record<string, unknown>) => editing
      ? api.patch(`/masterdata/room-availability/${editing.room_availability_id}`, body)
      : api.post('/masterdata/room-availability', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['room-availability'] }); onSaved(editing ? 'Room availability updated.' : 'Room availability created.'); onClose(); },
    onError: (e: any) => setErr(e?.error?.message ?? 'Save failed'),
  });

  if (!open) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    const body: Record<string, unknown> = {
      day: form.day,
      start_time: form.start_time,
      end_time: form.end_time,
      availability_type: form.availability_type,
      data_status: form.data_status,
    };
    if (!editing) {
      body.room_id = Number(form.room_id);
      body.term_id = Number(form.term_id);
    }
    mut.mutate(body);
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Room Availability' : 'Add Room Availability'} size="md">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Room</label>
            <select className="input" value={form.room_id} onChange={e => setForm(p => ({ ...p, room_id: e.target.value }))} required disabled={!!editing}>
              <option value="">Select room</option>
              {rooms.map(r => <option key={r.room_id} value={r.room_id} disabled={!editing && !r.is_active}>{r.room_code}{r.is_active ? '' : ' (inactive)'}</option>)}
            </select></div>
          <div><label className="label">Academic Term</label>
            <select className="input" value={form.term_id} onChange={e => setForm(p => ({ ...p, term_id: e.target.value }))} required disabled={!!editing}>
              <option value="">Select term</option>
              {terms.map(t => <option key={t.term_id} value={t.term_id}>{t.term_name}</option>)}
            </select></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Day</label>
            <select className="input" value={form.day} onChange={e => setForm(p => ({ ...p, day: e.target.value }))}>
              {DAYS.map(day => <option key={day} value={day}>{day}</option>)}
            </select></div>
          <div><label className="label">Availability</label>
            <select className="input" value={form.availability_type} onChange={e => setForm(p => ({ ...p, availability_type: e.target.value as AvailabilityType }))}>
              {AVAILABILITY_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
            </select></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Start Time</label>
            <input type="time" className="input" value={form.start_time} onChange={e => setForm(p => ({ ...p, start_time: e.target.value }))} required step={60} /></div>
          <div><label className="label">End Time</label>
            <input type="time" className="input" value={form.end_time} onChange={e => setForm(p => ({ ...p, end_time: e.target.value }))} required step={60} /></div>
        </div>
        <div><label className="label">Data Status</label>
          <select className="input" value={form.data_status} onChange={e => setForm(p => ({ ...p, data_status: e.target.value }))}>
            {DATA_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
          </select></div>
        {err && <FormError message={err} />}
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={mut.isPending}>{mut.isPending ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Teaching Day Modal ────────────────────────────────────────────────────────
function TeachingDayModal({ open, onClose, editing, terms }: { open: boolean; onClose: () => void; editing: TeachingDay | null; terms: Term[] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(
    editing
      ? { term_id: editing.term_id, day_name: editing.day_name, is_teaching_day: editing.is_teaching_day, closing_time: editing.closing_time ?? '' }
      : { term_id: terms[0]?.term_id ?? 0, day_name: 'MON' as string, is_teaching_day: 1, closing_time: '' }
  );
  const [err, setErr] = useState('');

  const mut = useMutation({
    mutationFn: (b: any) => editing ? api.patch(`/masterdata/teaching-days/${editing.term_day_id}`, b) : api.post('/masterdata/teaching-days', b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['teaching-days'] }); onClose(); },
    onError: (e: any) => setErr(e?.error?.message ?? 'Save failed'),
  });

  if (!open) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const b: any = { is_teaching_day: form.is_teaching_day };
    if (!editing) { b.term_id = form.term_id; b.day_name = form.day_name; }
    if (form.closing_time) b.closing_time = form.closing_time;
    mut.mutate(b);
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Teaching Day' : 'Add Teaching Day'} size="sm">
      <form onSubmit={submit} className="space-y-4">
        {!editing && <>
          <div><label className="label">Term</label>
            <select className="input" value={form.term_id} onChange={e => setForm(p => ({ ...p, term_id: +e.target.value }))} required>
              {terms.map(t => <option key={t.term_id} value={t.term_id}>{t.term_name}</option>)}
            </select></div>
          <div><label className="label">Day</label>
            <select className="input" value={form.day_name} onChange={e => setForm(p => ({ ...p, day_name: e.target.value }))}>
              {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
            </select></div>
        </>}
        <div className="flex items-center gap-2">
          <input type="checkbox" id="tda" checked={!!form.is_teaching_day} onChange={e => setForm(p => ({ ...p, is_teaching_day: e.target.checked ? 1 : 0 }))} />
          <label htmlFor="tda" className="text-sm">Teaching day</label>
        </div>
        <div>
          <label className="label">Closing Time (required for SAT)</label>
          <input type="time" className="input" value={form.closing_time} onChange={e => setForm(p => ({ ...p, closing_time: e.target.value }))} step={60} />
          <p className="text-xs text-gray-400 mt-0.5">Saturday classes must finish by 12:30. Leave blank for weekdays with no closing time.</p>
        </div>
        {err && <FormError message={err} />}
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={mut.isPending}>{mut.isPending ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Time Slot Modal ───────────────────────────────────────────────────────────
function TimeSlotModal({ open, onClose, editing, terms }: { open: boolean; onClose: () => void; editing: TimeSlot | null; terms: Term[] }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(
    editing
      ? { term_id: editing.term_id, slot_no: editing.slot_no, start_time: editing.start_time.slice(0, 5), end_time: editing.end_time.slice(0, 5), slot_type: editing.slot_type as string, data_status: editing.data_status }
      : { term_id: terms[0]?.term_id ?? 0, slot_no: 1, start_time: '', end_time: '', slot_type: 'TEACHING', data_status: 'VERIFY' }
  );
  const [err, setErr] = useState('');

  const mut = useMutation({
    mutationFn: (b: any) => editing ? api.patch(`/masterdata/time-slots/${editing.slot_id}`, b) : api.post('/masterdata/time-slots', b),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['time-slots'] }); onClose(); },
    onError: (e: any) => setErr(e?.error?.message ?? 'Save failed'),
  });

  if (!open) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const b: any = { start_time: form.start_time, end_time: form.end_time, slot_type: form.slot_type, data_status: form.data_status };
    if (!editing) { b.term_id = form.term_id; b.slot_no = form.slot_no; }
    mut.mutate(b);
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit Time Slot' : 'Add Time Slot'} size="sm">
      <form onSubmit={submit} className="space-y-4">
        {!editing && <>
          <div><label className="label">Term</label>
            <select className="input" value={form.term_id} onChange={e => setForm(p => ({ ...p, term_id: +e.target.value }))} required>
              {terms.map(t => <option key={t.term_id} value={t.term_id}>{t.term_name}</option>)}
            </select></div>
          <div><label className="label">Slot Number</label>
            <input type="number" className="input" min={1} max={50} value={form.slot_no} onChange={e => setForm(p => ({ ...p, slot_no: +e.target.value }))} required /></div>
        </>}
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Start Time</label>
            <input type="time" className="input" value={form.start_time} onChange={e => setForm(p => ({ ...p, start_time: e.target.value }))} required step={60} /></div>
          <div><label className="label">End Time</label>
            <input type="time" className="input" value={form.end_time} onChange={e => setForm(p => ({ ...p, end_time: e.target.value }))} required step={60} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Slot Type</label>
            <select className="input" value={form.slot_type} onChange={e => setForm(p => ({ ...p, slot_type: e.target.value }))}>
              {SLOT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select></div>
          <div><label className="label">Data Status</label>
            <select className="input" value={form.data_status} onChange={e => setForm(p => ({ ...p, data_status: e.target.value }))}>
              {DATA_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select></div>
        </div>
        {err && <FormError message={err} />}
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={mut.isPending}>{mut.isPending ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export function RoomsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('rooms');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string; resource: string; qKey: string } | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [filterTermId, setFilterTermId] = useState('');
  const [filterRoomId, setFilterRoomId] = useState('');

  const { data: rooms = [], isLoading: lR, error: eR } = useQuery({ queryKey: ['rooms'], queryFn: () => listRequest<Room>('/masterdata/rooms?limit=500'), select: r => r.data });
  const { data: roomTypes = [], isLoading: lRT, error: eRT } = useQuery({ queryKey: ['room-types'], queryFn: () => listRequest<RoomType>('/masterdata/room-types?limit=100'), select: r => r.data });
  const { data: terms = [], error: eTerms } = useQuery({ queryKey: ['terms'], queryFn: () => listRequest<Term>('/masterdata/terms?limit=500'), select: r => r.data });
  const { data: allSlots = [], isLoading: lS, error: eS } = useQuery({ queryKey: ['time-slots'], queryFn: () => listRequest<TimeSlot>('/masterdata/time-slots?limit=500'), select: r => r.data });
  const { data: allDays = [], isLoading: lD, error: eD } = useQuery({ queryKey: ['teaching-days'], queryFn: () => listRequest<TeachingDay>('/masterdata/teaching-days?limit=500'), select: r => r.data });
  const { data: availability = [], isLoading: lA, error: eA } = useQuery({
    queryKey: ['room-availability', filterRoomId, filterTermId],
    queryFn: () => listRequest<RoomAvailability>(`/masterdata/room-availability?limit=500&room_id=${filterRoomId}&term_id=${filterTermId}`),
    enabled: tab === 'availability' && !!filterRoomId && !!filterTermId,
    select: r => r.data,
  });

  const rtMap = Object.fromEntries(roomTypes.map(r => [r.room_type_id, r.type_name]));
  const termMap = Object.fromEntries(terms.map(t => [t.term_id, t.term_name]));
  const roomMap = Object.fromEntries(rooms.map(r => [r.room_id, r.room_code]));

  const slots = filterTermId ? allSlots.filter(s => String(s.term_id) === filterTermId) : allSlots;
  const days = filterTermId ? allDays.filter(d => String(d.term_id) === filterTermId) : allDays;

  const deleteMut = useMutation({
    mutationFn: ({ id, resource }: { id: number; resource: string; qKey: string }) => api.delete(`/masterdata/${resource}/${id}`),
    onSuccess: (_, v) => { qc.invalidateQueries({ queryKey: [v.qKey] }); setDeleteTarget(null); setDeleteError(''); setSuccessMessage('Record deleted.'); },
    onError: (e: any) => setDeleteError(e?.error?.message ?? 'Cannot delete — record may be in use. Deactivate instead.'),
  });

  const error = eR || eRT || eTerms || eS || eD || eA;
  if (error) return <ErrorMessage error={error} />;

  const tabConfig: Record<Tab, { label: string; resource: string; qKey: string }> = {
    'rooms':      { label: 'Room',          resource: 'rooms',         qKey: 'rooms' },
    'room-types': { label: 'Room Type',     resource: 'room-types',    qKey: 'room-types' },
    'availability': { label: 'Room Availability', resource: 'room-availability', qKey: 'room-availability' },
    'slots':      { label: 'Time Slot',     resource: 'time-slots',    qKey: 'time-slots' },
    'days':       { label: 'Teaching Day',  resource: 'teaching-days', qKey: 'teaching-days' },
  };

  function openDelete(id: number, label: string) {
    setDeleteTarget({ id, label, resource: tabConfig[tab].resource, qKey: tabConfig[tab].qKey });
    setDeleteError('');
  }

  // key forces modal remount with fresh state each open/editing change
  const modalKey = `${tab}-${editing ? (editing.room_availability_id ?? editing.room_id ?? editing.room_type_id ?? editing.slot_id ?? editing.term_day_id) : 'new'}-${showForm}`;

  const actionCol = (row: any, idKey: string, labelKey: string) => (
    <div className="flex gap-1">
      <button className="btn-ghost btn-sm" onClick={() => { setSuccessMessage(''); setEditing(row); setShowForm(true); }}><PencilIcon className="w-3.5 h-3.5" /></button>
      <button className="btn-ghost btn-sm text-red-500" onClick={() => { setSuccessMessage(''); openDelete(row[idKey], String(row[labelKey])); }}><Trash2Icon className="w-3.5 h-3.5" /></button>
    </div>
  );

  const tabs: { key: Tab; label: string }[] = [
    { key: 'rooms',      label: 'Rooms' },
    { key: 'room-types', label: 'Room Types' },
    { key: 'availability', label: 'Availability' },
    { key: 'slots',      label: 'Time Slots' },
    { key: 'days',       label: 'Teaching Days' },
  ];

  return (
    <div>
      <PageHeader title="Rooms & Timetable Settings"
        subtitle="Manage rooms, equipment, room availability, time slots and teaching day configuration."
        actions={<button className="btn-primary btn-sm" onClick={() => { setSuccessMessage(''); setEditing(null); setShowForm(true); }}><PlusIcon className="w-4 h-4" /> Add {tabConfig[tab].label}</button>} />

      <div className="flex gap-1 mb-5 border-b border-gray-200">
        {tabs.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setShowForm(false); setSuccessMessage(''); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {successMessage && <p role="status" className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{successMessage}</p>}

      {(tab === 'slots' || tab === 'days') && (
        <div className="mb-4">
          <select className="input w-52" value={filterTermId} onChange={e => setFilterTermId(e.target.value)}>
            <option value="">All terms</option>
            {terms.map(t => <option key={t.term_id} value={t.term_id}>{t.term_name}</option>)}
          </select>
        </div>
      )}
      {tab === 'availability' && (
        <div className="mb-4 flex flex-wrap gap-3">
          <select className="input w-64" value={filterRoomId} onChange={e => setFilterRoomId(e.target.value)}>
            <option value="">Select room</option>
            {rooms.map(r => <option key={r.room_id} value={r.room_id}>{r.room_code}{r.is_active ? '' : ' (inactive)'}</option>)}
          </select>
          <select className="input w-64" value={filterTermId} onChange={e => setFilterTermId(e.target.value)}>
            <option value="">Select term</option>
            {terms.map(t => <option key={t.term_id} value={t.term_id}>{t.term_name}</option>)}
          </select>
        </div>
      )}

      {tab === 'rooms' && (
        <DataTable<Room> columns={[
          { header: 'Code', accessor: 'room_code' },
          { header: 'Name', accessor: r => r.room_name ?? '—' },
          { header: 'Type', accessor: r => rtMap[r.room_type_id] ?? r.room_type_id },
          { header: 'Capacity', accessor: r => r.capacity ?? '—' },
          { header: 'Location', accessor: r => r.location ?? '—' },
          { header: 'Equipment / Features', accessor: r => r.equipment ?? '—' },
          { header: 'Practical', accessor: r => r.practical_approved ? <Badge variant="green">Approved</Badge> : <Badge variant="gray">Not approved</Badge> },
          { header: 'Status', accessor: r => <Badge variant={r.is_active ? 'green' : 'gray'}>{r.is_active ? 'Active' : 'Inactive'}</Badge> },
          { header: 'Data', accessor: r => <StatusBadge status={r.data_status} /> },
          { header: '', accessor: r => actionCol(r, 'room_id', 'room_code') },
        ]} data={rooms} keyField="room_id" loading={lR} emptyTitle="No rooms" />
      )}

      {tab === 'room-types' && (
        <DataTable<RoomType> columns={[
          { header: 'Code', accessor: 'type_code' },
          { header: 'Name', accessor: 'type_name' },
          { header: 'Description', accessor: r => r.description ?? '—' },
          { header: 'Status', accessor: r => <Badge variant={r.is_active ? 'green' : 'gray'}>{r.is_active ? 'Active' : 'Inactive'}</Badge> },
          { header: '', accessor: r => actionCol(r, 'room_type_id', 'type_name') },
        ]} data={roomTypes} keyField="room_type_id" loading={lRT} emptyTitle="No room types" />
      )}

      {tab === 'availability' && (
        <DataTable<RoomAvailability> columns={[
          { header: 'Room', accessor: r => roomMap[r.room_id] ?? r.room_id },
          { header: 'Term', accessor: r => termMap[r.term_id] ?? r.term_id },
          { header: 'Day', accessor: 'day' },
          { header: 'Start', accessor: r => r.start_time.slice(0, 5) },
          { header: 'End', accessor: r => r.end_time.slice(0, 5) },
          { header: 'Availability', accessor: r => <Badge variant={r.availability_type === 'AVAILABLE' ? 'green' : r.availability_type === 'UNAVAILABLE' ? 'red' : 'gray'}>{r.availability_type}</Badge> },
          { header: 'Data', accessor: r => <StatusBadge status={r.data_status} /> },
          { header: '', accessor: r => actionCol(r, 'room_availability_id', 'day') },
        ]} data={availability} keyField="room_availability_id" loading={lA} emptyTitle="No room availability" emptyDescription={filterRoomId && filterTermId ? 'No availability windows are saved for this room and term.' : 'Select a room and academic term to view saved availability.'} />
      )}

      {tab === 'slots' && (
        <DataTable<TimeSlot> columns={[
          { header: 'Term', accessor: s => termMap[s.term_id] ?? s.term_id },
          { header: 'Slot No', accessor: 'slot_no' },
          { header: 'Start', accessor: s => s.start_time.slice(0, 5) },
          { header: 'End', accessor: s => s.end_time.slice(0, 5) },
          { header: 'Type', accessor: s => <Badge variant={s.slot_type === 'TEACHING' ? 'blue' : s.slot_type === 'BREAK' ? 'yellow' : 'gray'}>{s.slot_type}</Badge> },
          { header: 'Data', accessor: s => <StatusBadge status={s.data_status} /> },
          { header: '', accessor: s => actionCol(s, 'slot_id', 'slot_no') },
        ]} data={slots} keyField="slot_id" loading={lS} emptyTitle="No time slots" emptyDescription="Configure time slots per academic term." />
      )}

      {tab === 'days' && (
        <DataTable<TeachingDay> columns={[
          { header: 'Term', accessor: d => termMap[d.term_id] ?? d.term_id },
          { header: 'Day', accessor: 'day_name' },
          { header: 'Teaching', accessor: d => <Badge variant={d.is_teaching_day ? 'green' : 'gray'}>{d.is_teaching_day ? 'Yes' : 'No'}</Badge> },
          { header: 'Closing Time', accessor: d => d.closing_time ?? '—' },
          { header: '', accessor: d => actionCol(d, 'term_day_id', 'day_name') },
        ]} data={days} keyField="term_day_id" loading={lD} emptyTitle="No teaching days" />
      )}

      {tab === 'room-types' && <RoomTypeModal key={modalKey} open={showForm} onClose={() => setShowForm(false)} editing={editing} />}
      {tab === 'rooms'      && <RoomModal     key={modalKey} open={showForm} onClose={() => setShowForm(false)} onSaved={setSuccessMessage} editing={editing} roomTypes={roomTypes} />}
      {tab === 'availability' && <RoomAvailabilityModal key={modalKey} open={showForm} onClose={() => setShowForm(false)} onSaved={setSuccessMessage} editing={editing} rooms={rooms} terms={terms} selectedRoomId={filterRoomId} selectedTermId={filterTermId} />}
      {tab === 'days'       && <TeachingDayModal key={modalKey} open={showForm} onClose={() => setShowForm(false)} editing={editing} terms={terms} />}
      {tab === 'slots'      && <TimeSlotModal    key={modalKey} open={showForm} onClose={() => setShowForm(false)} editing={editing} terms={terms} />}

      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => { setDeleteTarget(null); setDeleteError(''); }}
        onConfirm={() => deleteTarget && deleteMut.mutate({ id: deleteTarget.id, resource: deleteTarget.resource, qKey: deleteTarget.qKey })}
        title={`Delete ${tabConfig[tab].label}`}
        message={`Delete "${deleteTarget?.label}"? If timetable records reference this, it will be blocked.`}
        confirmLabel="Delete" danger loading={deleteMut.isPending}>
        {deleteError && <p className="text-xs text-red-600 mt-2">{deleteError}</p>}
      </ConfirmModal>
    </div>
  );
}
