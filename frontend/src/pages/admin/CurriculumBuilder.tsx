import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, listRequest } from '@/lib/api';
import { hasCurriculumDraftEditorContent } from '@/lib/curriculumDraftEditor';
import { semestersForParity } from '@/lib/academicTermRules';
import { mappedSemestersForContext, schemesForProgram } from '@/lib/curriculumSelection';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import { ErrorMessage, FormError } from '@/components/ui/ErrorMessage';
import type {
  AcademicYear, Course, CourseComponent, CourseOffering, CurriculumCourse, Program, RoomType, Scheme, Section, Semester, Term,
} from '@/types';

type ComponentType = CourseComponent['component_type'] | '';
interface DraftComponent {
  component_type: ComponentType;
  weekly_hours: string;
  periods_per_session: string;
  is_consecutive: boolean;
  required_room_type_id: string;
}
interface DraftSubject {
  course_code: string;
  course_name: string;
  category: string;
  credits: string;
  required_weekly_hours: string;
  is_elective: boolean;
  audience_section_ids: number[];
  components: DraftComponent[];
}
interface Payload {
  year_id: number;
  term_id: number;
  program_id: number;
  scheme_id: number;
  semester_id: number;
  subjects: Array<{
    course_code: string;
    course_name: string;
    category?: string;
    credits?: number;
    required_weekly_hours: number;
    is_elective: boolean;
    audience_section_ids: number[];
    components: Array<{
      component_type: Exclude<ComponentType, ''>;
      weekly_hours: number;
      periods_per_session?: number;
      is_consecutive: boolean;
      required_room_type_id?: number;
    }>;
  }>;
}
interface MappingResponse {
  mappingAvailable: boolean;
  rows: Array<{ scheme_id: number; semester_id: number; is_active: number }>;
}
interface CurriculumDraftContext {
  year_id: number;
  term_id: number;
  program_id: number;
  scheme_id: number;
  semester_id: number;
}
interface SavedCurriculumDraft extends CurriculumDraftContext {
  draft_id: number;
  subjects: DraftSubject[];
  version: number;
  created_at: string;
  updated_at: string;
}
interface CurriculumDraftResponse {
  available: boolean;
  draft: SavedCurriculumDraft | null;
}
interface OfferingAudience {
  audience_id: number;
  offering_id: number;
  section_id: number;
  batch_id: number | null;
  data_status: string;
}
interface SchedulingReadiness {
  ready: boolean;
  expected_divisions: number;
  actual_divisions: number;
  active_semesters: number[];
  rooms: Array<{ room_id: number; room_code: string; data_status: string }>;
  issues: Array<{ severity: string; rule_code: string; message: string }>;
}
const componentTypes: Exclude<ComponentType, ''>[] = ['THEORY', 'LAB', 'TUTORIAL', 'PROJECT'];
const blankComponent = (): DraftComponent => ({
  component_type: '', weekly_hours: '', periods_per_session: '', is_consecutive: false, required_room_type_id: '',
});
const blankSubject = (): DraftSubject => ({
  course_code: '', course_name: '', category: '', credits: '', required_weekly_hours: '',
  is_elective: false, audience_section_ids: [], components: [],
});

export function CurriculumBuilder() {
  const qc = useQueryClient();
  const [yearId, setYearId] = useState(0);
  const [termId, setTermId] = useState(0);
  const [programId, setProgramId] = useState(0);
  const [schemeId, setSchemeId] = useState(0);
  const [semesterId, setSemesterId] = useState(0);
  const [countInput, setCountInput] = useState('1');
  const [draft, setDraft] = useState<DraftSubject[]>([blankSubject()]);
  const [validated, setValidated] = useState<Payload | null>(null);
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');
  const [restoredDraftId, setRestoredDraftId] = useState<number | null>(null);
  const draftRevision = useRef(0);

  const yearsQuery = useQuery({ queryKey: ['academic-years'], queryFn: () => listRequest<AcademicYear>('/masterdata/academic-years?limit=500') });
  const termsQuery = useQuery({ queryKey: ['terms'], queryFn: () => listRequest<Term>('/masterdata/terms?limit=500') });
  const programsQuery = useQuery({ queryKey: ['programs'], queryFn: () => listRequest<Program>('/masterdata/programs?limit=500') });
  const schemesQuery = useQuery({ queryKey: ['schemes'], queryFn: () => listRequest<Scheme>('/masterdata/schemes?limit=500') });
  const semestersQuery = useQuery({ queryKey: ['semesters'], queryFn: () => listRequest<Semester>('/masterdata/semesters?limit=500') });
  const roomsQuery = useQuery({ queryKey: ['room-types'], queryFn: () => listRequest<RoomType>('/masterdata/room-types?limit=100') });
  const coursesQuery = useQuery({ queryKey: ['courses'], queryFn: () => listRequest<Course>('/masterdata/courses?limit=500') });
  const componentsQuery = useQuery({ queryKey: ['components'], queryFn: () => listRequest<CourseComponent>('/masterdata/components?limit=500') });

  const years = yearsQuery.data?.data ?? [];
  const terms = termsQuery.data?.data ?? [];
  const programs = programsQuery.data?.data ?? [];
  const schemes = schemesQuery.data?.data ?? [];
  const semesters = semestersQuery.data?.data ?? [];
  const roomTypes = roomsQuery.data?.data ?? [];
  const courses = coursesQuery.data?.data ?? [];
  const components = componentsQuery.data?.data ?? [];
  const activeYears = years.filter(year => year.is_active);
  const selectedYear = activeYears.find(year => year.year_id === yearId) ?? activeYears[0];
  const termsForYear = terms.filter(term => term.year_id === selectedYear?.year_id && term.status !== 'CLOSED');
  const selectedTerm = termsForYear.find(term => term.term_id === termId) ?? termsForYear[0];
  const activePrograms = programs.filter(program => program.is_active);
  const selectedProgram = activePrograms.find(program => program.program_id === programId) ?? activePrograms[0];

  const mappingQuery = useQuery({
    queryKey: ['curriculum-builder-mappings', selectedTerm?.term_id],
    queryFn: () => api.get<MappingResponse>(`/masterdata/curriculum-builder/term-semesters?term_id=${selectedTerm?.term_id}`),
    enabled: !!selectedTerm,
  });
  const schedulingReadinessQuery = useQuery({
    queryKey: ['curriculum-builder-scheduling-readiness', selectedTerm?.term_id],
    queryFn: () => api.get<SchedulingReadiness>(`/timetable/configuration/${selectedTerm?.term_id}`),
    enabled: !!selectedTerm,
  });
  const eligibleSchemes = schemesForProgram(schemes, selectedProgram?.program_id);
  const selectedScheme = eligibleSchemes.find(scheme => scheme.scheme_id === schemeId) ?? eligibleSchemes[0];
  const eligibleSemesters = mappedSemestersForContext(
    semesters,
    mappingQuery.data?.rows ?? [],
    selectedScheme?.scheme_id,
    selectedTerm?.parity,
    mappingQuery.data?.mappingAvailable ?? false,
  );
  const selectedSemester = eligibleSemesters.find(semester => semester.semester_id === semesterId) ?? eligibleSemesters[0];

  const sectionsQuery = useQuery({
    queryKey: ['curriculum-builder-sections', selectedTerm?.term_id, selectedProgram?.program_id, selectedScheme?.scheme_id, selectedSemester?.semester_id],
    queryFn: () => listRequest<Section>(
      `/masterdata/sections?term_id=${selectedTerm?.term_id}&scheme_id=${selectedScheme?.scheme_id}&semester_id=${selectedSemester?.semester_id}&limit=500`),
    enabled: !!selectedTerm && !!selectedProgram && !!selectedScheme && !!selectedSemester,
  });
  const activeContextSections = (sectionsQuery.data?.data ?? []).filter(section =>
    Boolean(section.is_active)
    && section.term_id === selectedTerm?.term_id
    && section.scheme_id === selectedScheme?.scheme_id
    && section.semester_id === selectedSemester?.semester_id);

  const savedQuery = useQuery({
    queryKey: ['curriculum-builder-saved', selectedScheme?.scheme_id, selectedSemester?.semester_id],
    queryFn: () => listRequest<CurriculumCourse>(
      `/masterdata/curriculum-courses?scheme_id=${selectedScheme?.scheme_id}&semester_id=${selectedSemester?.semester_id}&limit=500`),
    enabled: !!selectedScheme && !!selectedSemester,
  });
  const offeringsQuery = useQuery({
    queryKey: ['curriculum-builder-offerings', selectedTerm?.term_id],
    queryFn: () => listRequest<CourseOffering>(`/masterdata/offerings?term_id=${selectedTerm?.term_id}&limit=500`),
    enabled: !!selectedTerm,
  });
  const audiencesQuery = useQuery({
    queryKey: ['curriculum-builder-audiences', selectedTerm?.term_id],
    queryFn: () => listRequest<OfferingAudience>(`/masterdata/audiences?term_id=${selectedTerm?.term_id}&limit=500`),
    enabled: !!selectedTerm,
  });

  const selectedContext: CurriculumDraftContext | null = selectedYear && selectedTerm && selectedProgram && selectedScheme && selectedSemester
    ? {
      year_id: selectedYear.year_id,
      term_id: selectedTerm.term_id,
      program_id: selectedProgram.program_id,
      scheme_id: selectedScheme.scheme_id,
      semester_id: selectedSemester.semester_id,
    }
    : null;
  const draftContextKey = selectedContext
    ? `${selectedContext.year_id}:${selectedContext.term_id}:${selectedContext.program_id}:${selectedContext.scheme_id}:${selectedContext.semester_id}`
    : 'unselected';
  const draftQueryKey = ['curriculum-builder-draft', draftContextKey] as const;
  const draftQuery = useQuery({
    queryKey: draftQueryKey,
    queryFn: () => {
      if (!selectedContext) throw new Error('Select an academic context to load its saved draft.');
      const params = new URLSearchParams(Object.entries(selectedContext).map(([key, value]) => [key, String(value)]));
      return api.get<CurriculumDraftResponse>(`/masterdata/curriculum-builder/draft?${params.toString()}`);
    },
    enabled: !!selectedContext,
  });

  const clearValidation = () => {
    draftRevision.current += 1;
    setValidated(null);
    setMessage('');
    setFormError('');
  };
  const validateMutation = useMutation({
    mutationFn: ({ payload }: { payload: Payload; revision: number }) => api.post<{ valid: boolean; subject_count: number; component_count: number; mapping_available: boolean }>(
      '/masterdata/curriculum-builder/validate', payload),
    onSuccess: (result, { payload, revision }) => {
      if (revision !== draftRevision.current) return;
      setValidated(payload);
      setMessage(`Validated ${result.subject_count} subject(s), ${result.component_count} component(s). You can now publish.`);
    },
    onError: (error: any, { revision }) => {
      if (revision === draftRevision.current) setFormError(error?.error?.message ?? 'Unable to validate this curriculum.');
    },
  });
  const saveDraftMutation = useMutation({
    mutationFn: (input: {
      context: CurriculumDraftContext;
      subjects: DraftSubject[];
      draftId?: number;
      expectedVersion?: number;
    }) => input.draftId
      ? api.put<SavedCurriculumDraft>(`/masterdata/curriculum-builder/drafts/${input.draftId}`, {
        ...input.context,
        subjects: input.subjects,
        expected_version: input.expectedVersion,
      })
      : api.post<SavedCurriculumDraft>('/masterdata/curriculum-builder/drafts', {
        ...input.context,
        subjects: input.subjects,
      }),
    onSuccess: savedDraft => {
      qc.setQueryData<CurriculumDraftResponse>(draftQueryKey, { available: true, draft: savedDraft });
      setRestoredDraftId(savedDraft.draft_id);
      setMessage(`Draft saved (version ${savedDraft.version}).`);
      setFormError('');
    },
    onError: (error: any) => setFormError(error?.error?.message ?? 'Unable to save this curriculum draft.'),
  });
  const deleteDraftMutation = useMutation({
    mutationFn: (input: { context: CurriculumDraftContext; draft: SavedCurriculumDraft }) => {
      const params = new URLSearchParams({
        ...Object.fromEntries(Object.entries(input.context).map(([key, value]) => [key, String(value)])),
        expected_version: String(input.draft.version),
      });
      return api.delete(`/masterdata/curriculum-builder/drafts/${input.draft.draft_id}?${params.toString()}`);
    },
    onSuccess: () => {
      qc.setQueryData<CurriculumDraftResponse>(draftQueryKey, { available: true, draft: null });
      setRestoredDraftId(null);
      setMessage('Saved curriculum draft deleted.');
      setFormError('');
    },
    onError: (error: any) => setFormError(error?.error?.message ?? 'Unable to delete this curriculum draft.'),
  });
  const publishMutation = useMutation({
    mutationFn: async ({ payload, subjects }: { payload: Payload; revision: number; subjects: DraftSubject[] }) => {
      let draftMetadata: { draft_id: number; draft_version: number } | undefined;
      const savedDraft = draftQuery.data?.draft;
      if (savedDraft) {
        if (restoredDraftId !== savedDraft.draft_id || !selectedContext) {
          throw new Error('Restore the saved curriculum draft before publishing this context.');
        }
        const updatedDraft = await api.put<SavedCurriculumDraft>(`/masterdata/curriculum-builder/drafts/${savedDraft.draft_id}`, {
          ...selectedContext,
          subjects,
          expected_version: savedDraft.version,
        });
        qc.setQueryData<CurriculumDraftResponse>(draftQueryKey, { available: true, draft: updatedDraft });
        draftMetadata = { draft_id: updatedDraft.draft_id, draft_version: updatedDraft.version };
      }
      return api.post<{ subjects: Array<{ audience_ids: number[] }>; message: string }>('/masterdata/curriculum-builder/publish', {
        ...payload,
        ...draftMetadata,
      });
    },
    onSuccess: (result, { revision }) => {
      if (revision === draftRevision.current) {
        setValidated(null);
        setDraft([blankSubject()]);
        setCountInput('1');
        setFormError('');
        setRestoredDraftId(null);
      }
      setMessage(result.message);
      if (draftQuery.data?.draft) {
        qc.setQueryData<CurriculumDraftResponse>(draftQueryKey, { available: true, draft: null });
      }
      qc.invalidateQueries({ queryKey: ['courses'] });
      qc.invalidateQueries({ queryKey: ['components'] });
      qc.invalidateQueries({ queryKey: ['offerings'] });
      qc.invalidateQueries({ queryKey: ['curriculum-builder-offerings'] });
      qc.invalidateQueries({ queryKey: ['curriculum-builder-audiences'] });
      qc.invalidateQueries({ queryKey: ['curriculum-builder-saved'] });
    },
    onError: (error: any, { revision }) => {
      if (revision === draftRevision.current) {
        setValidated(null);
        setFormError(error?.error?.message ?? 'Publish failed. No curriculum changes were saved.');
      }
    },
  });

  const isLoading = [yearsQuery, termsQuery, programsQuery, schemesQuery, semestersQuery, roomsQuery, coursesQuery, componentsQuery, sectionsQuery]
    .some(query => query.isLoading);
  const loadError = [yearsQuery, termsQuery, programsQuery, schemesQuery, semestersQuery, roomsQuery, coursesQuery, componentsQuery, sectionsQuery]
    .find(query => query.error)?.error;

  function editSubject(index: number, changes: Partial<DraftSubject>) {
    clearValidation();
    setDraft(rows => rows.map((subject, rowIndex) => rowIndex === index ? { ...subject, ...changes } : subject));
  }
  function editComponent(subjectIndex: number, componentIndex: number, changes: Partial<DraftComponent>) {
    clearValidation();
    setDraft(rows => rows.map((subject, rowIndex) => rowIndex !== subjectIndex ? subject : {
      ...subject,
      components: subject.components.map((component, index) => index === componentIndex ? { ...component, ...changes } : component),
    }));
  }
  function decimal(raw: string, name: string, max: number, decimals = 2, min = 0.01) {
    const regex = decimals === 1 ? /^\d+(\.\d)?$/ : /^\d+(\.\d{1,2})?$/;
    const value = Number(raw);
    if (!raw || !regex.test(raw) || !Number.isFinite(value) || value < min || value > max) {
      throw new Error(`${name} must be from ${min} to ${max} with at most ${decimals} decimal place(s).`);
    }
    return value;
  }
  function payloadFromDraft(): Payload {
    if (!selectedYear || !selectedTerm || !selectedProgram || !selectedScheme || !selectedSemester) {
      throw new Error('Select a valid academic year, term, program, scheme, and semester.');
    }
    if (draft.length < 1 || draft.length > 100) throw new Error('Generate between 1 and 100 subject rows.');
    const codes = new Set<string>();
    const subjects = draft.map((subject, index) => {
      const course_code = subject.course_code.trim();
      const course_name = subject.course_name.trim();
      if (!course_code || course_code.length > 30) throw new Error(`Subject ${index + 1}: code is required and limited to 30 characters.`);
      if (!course_name || course_name.length > 200) throw new Error(`Subject ${index + 1}: name is required and limited to 200 characters.`);
      const normalized = course_code.toLowerCase();
      if (codes.has(normalized)) throw new Error(`Subject code "${course_code}" is repeated in this draft.`);
      codes.add(normalized);
      if (subject.category.trim().length > 20) throw new Error(`Subject ${index + 1}: category is limited to 20 characters.`);
      const required_weekly_hours = decimal(subject.required_weekly_hours, `Subject ${index + 1} weekly hours`, 99.99);
      if (!subject.components.length) throw new Error(`Subject ${index + 1}: add at least one component.`);
      const types = new Set<string>();
      const parsedComponents = subject.components.map((component, componentIndex) => {
        if (!component.component_type) throw new Error(`Subject ${index + 1}, component ${componentIndex + 1}: choose a type.`);
        if (types.has(component.component_type)) throw new Error(`Subject ${index + 1}: component types must not repeat.`);
        types.add(component.component_type);
        const weekly_hours = decimal(component.weekly_hours, `Subject ${index + 1} component hours`, 99.99);
        const periods = component.periods_per_session ? Number(component.periods_per_session) : undefined;
        if (periods !== undefined && (!Number.isInteger(periods) || periods < 1 || periods > 12)) {
          throw new Error('Periods per session must be an integer from 1 to 12.');
        }
        if (component.is_consecutive && (periods ?? 0) < 2) throw new Error('A consecutive component requires at least two periods per session.');
        const roomTypeId = component.required_room_type_id ? Number(component.required_room_type_id) : undefined;
        if (roomTypeId !== undefined && !roomTypes.some(room => room.room_type_id === roomTypeId && room.is_active)) {
          throw new Error('Select an active room type for each component.');
        }
        return {
          component_type: component.component_type as Exclude<ComponentType, ''>,
          weekly_hours,
          ...(periods ? { periods_per_session: periods } : {}),
          is_consecutive: component.is_consecutive,
          ...(roomTypeId ? { required_room_type_id: roomTypeId } : {}),
        };
      });
      const componentHours = parsedComponents.reduce((sum, component) => sum + component.weekly_hours, 0);
      if (Math.abs(componentHours - required_weekly_hours) > 0.001) {
        throw new Error(`Subject ${index + 1}: component hours must add up to required weekly hours.`);
      }
      const credits = subject.credits.trim() ? decimal(subject.credits, `Subject ${index + 1} credits`, 99.9, 1, 0) : undefined;
      if (!subject.audience_section_ids.length) {
        throw new Error(`Subject ${index + 1}: select at least one active division for its term offering.`);
      }
      const activeSectionIds = new Set(activeContextSections.map(section => section.section_id));
      if (subject.audience_section_ids.some(sectionId => !activeSectionIds.has(sectionId))) {
        throw new Error(`Subject ${index + 1}: selected divisions no longer match this term and semester. Refresh the page and review the audience selections.`);
      }
      return {
        course_code, course_name,
        ...(subject.category.trim() ? { category: subject.category.trim() } : {}),
        ...(credits !== undefined ? { credits } : {}),
        required_weekly_hours, is_elective: subject.is_elective,
        audience_section_ids: subject.audience_section_ids,
        components: parsedComponents,
      };
    });
    return {
      year_id: selectedYear.year_id, term_id: selectedTerm.term_id, program_id: selectedProgram.program_id,
      scheme_id: selectedScheme.scheme_id, semester_id: selectedSemester.semester_id, subjects,
    };
  }
  function validateDraft() {
    clearValidation();
    if (draftQuery.error) {
      setFormError('Unable to check for an existing saved draft. Retry loading the draft before validating.');
      return;
    }
    if (draftQuery.isLoading) {
      setFormError('Wait for the selected context draft to finish loading before validating.');
      return;
    }
    if (draftQuery.data?.draft && restoredDraftId !== draftQuery.data.draft.draft_id) {
      setFormError('Restore the saved draft for this context before validating or publishing.');
      return;
    }
    try { validateMutation.mutate({ payload: payloadFromDraft(), revision: draftRevision.current }); }
    catch (error) { setFormError(error instanceof Error ? error.message : 'Review the draft fields.'); }
  }
  function generateRows() {
    clearValidation();
    const count = Number(countInput);
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      setFormError('Generate between 1 and 100 subject rows.');
      return;
    }
    setDraft(current => Array.from({ length: count }, (_, index) => current[index] ?? blankSubject()));
  }
  function editorHasContent() {
    return hasCurriculumDraftEditorContent(draft);
  }
  function switchContext(setter: (value: number) => void, value: number) {
    if (editorHasContent() && !window.confirm('Discard the current unsaved editor changes and switch academic context? A saved draft remains available to restore.')) {
      return;
    }
    clearValidation();
    setDraft([blankSubject()]);
    setCountInput('1');
    setRestoredDraftId(null);
    setter(value);
  }
  function saveCurrentDraft() {
    if (!selectedContext) {
      setFormError('Select a complete academic context before saving a draft.');
      return;
    }
    if (draftQuery.error || draftQuery.isLoading) {
      setFormError('Wait until the saved-draft status has loaded before saving.');
      return;
    }
    const existing = draftQuery.data?.draft;
    if (existing && restoredDraftId !== existing.draft_id) {
      setFormError('Restore the existing saved draft before updating it.');
      return;
    }
    clearValidation();
    saveDraftMutation.mutate({
      context: selectedContext,
      subjects: draft,
      ...(existing ? { draftId: existing.draft_id, expectedVersion: existing.version } : {}),
    });
  }
  function restoreSavedDraft() {
    const savedDraft = draftQuery.data?.draft;
    if (!savedDraft) return;
    if (editorHasContent() && !window.confirm('Replace the current editor rows with the saved curriculum draft?')) return;
    clearValidation();
    setDraft(savedDraft.subjects.map(subject => ({
      ...subject,
      components: subject.components.map(component => ({ ...component })),
    })));
    setCountInput(String(savedDraft.subjects.length));
    setRestoredDraftId(savedDraft.draft_id);
    setMessage(`Restored saved draft version ${savedDraft.version}.`);
  }
  function deleteSavedDraft() {
    const savedDraft = draftQuery.data?.draft;
    if (!selectedContext || !savedDraft) return;
    if (!window.confirm('Delete the saved curriculum draft for this exact academic context?')) return;
    clearValidation();
    deleteDraftMutation.mutate({ context: selectedContext, draft: savedDraft });
  }

  if (isLoading) return <div className="card p-6 text-sm text-gray-500">Loading curriculum data…</div>;
  if (loadError) return <ErrorMessage error={loadError} />;
  if (mappingQuery.error) return <ErrorMessage error={mappingQuery.error} />;
  if (savedQuery.error) return <ErrorMessage error={savedQuery.error} />;
  if (offeringsQuery.error) return <ErrorMessage error={offeringsQuery.error} />;
  if (audiencesQuery.error) return <ErrorMessage error={audiencesQuery.error} />;

  const courseById = new Map(courses.map(course => [course.course_id, course]));
  const componentById = new Map(components.map(component => [component.component_id, component]));
  const sectionById = new Map(activeContextSections.map(section => [section.section_id, section]));
  const savedRows = savedQuery.data?.data ?? [];
  const savedComponents = components;
  const savedCourseIds = new Set(savedRows.map(row => row.course_id));
  const publishedOfferings = (offeringsQuery.data?.data ?? []).filter(offering => {
    const component = componentById.get(offering.component_id);
    return offering.term_id === selectedTerm?.term_id && !!component && savedCourseIds.has(component.course_id);
  });
  const publishedOfferingIds = new Set(publishedOfferings.map(offering => offering.offering_id));
  const audienceByOffering = new Map<number, OfferingAudience[]>();
  for (const audience of audiencesQuery.data?.data ?? []) {
    if (!publishedOfferingIds.has(audience.offering_id)) continue;
    audienceByOffering.set(audience.offering_id, [...(audienceByOffering.get(audience.offering_id) ?? []), audience]);
  }
  const paritySemesterExists = !!selectedScheme && semesters.some(semester =>
    semester.scheme_id === selectedScheme.scheme_id && Boolean(semester.is_active)
    && semestersForParity(selectedTerm?.parity).includes(semester.semester_no));
  const mappedParitySemesterExists = !!selectedScheme && (mappingQuery.data?.rows ?? []).some(row =>
    row.scheme_id === selectedScheme.scheme_id && Boolean(row.is_active)
    && semesters.some(semester => semester.semester_id === row.semester_id
      && semester.scheme_id === selectedScheme.scheme_id && Boolean(semester.is_active)
      && semestersForParity(selectedTerm?.parity).includes(semester.semester_no)));
  const currentSavedDraft = draftQuery.data?.draft ?? null;
  const isCurrentDraftRestored = !!currentSavedDraft && restoredDraftId === currentSavedDraft.draft_id;

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <h2 className="text-lg font-semibold">Curriculum and Subject Builder</h2>
        <p className="mt-1 text-sm text-gray-600">Build a draft, validate all subjects and components, then publish them together to the selected term.</p>
        <p className="mt-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          Saved drafts preserve incomplete subject rows without creating courses or offerings. Publishing still validates the complete curriculum and marks created records VERIFY for review.
        </p>
        {mappingQuery.data && !mappingQuery.data.mappingAvailable && <p className="mt-2 rounded-lg bg-yellow-50 p-3 text-xs text-yellow-900">
          Term-specific program-semester mappings are unavailable. Apply migration 005 and configure the selected term before validating or publishing; the builder will not assume a semester applies to every term.
        </p>}
        {mappingQuery.data?.mappingAvailable && selectedScheme && !eligibleSemesters.length && (
          <div className="mt-2 rounded-lg bg-yellow-50 p-3 text-xs text-yellow-900">
            {!paritySemesterExists
              ? `This scheme has no active semester record for the ${selectedTerm?.parity.toLowerCase()} parity. Do not create one unless it matches the approved curriculum scheme.`
              : !mappedParitySemesterExists
                ? `Active ${selectedTerm?.parity.toLowerCase()} semester records exist, but none are actively mapped to this term and scheme.`
                : 'No mapped semester is currently available for this term and scheme.'}
            {' '}Review existing records in{' '}
            <Link className="font-semibold underline" to="/admin/academic-structure">Academic Structure → Term Semesters</Link>.
            {' '}There, the authorized parity mapping action maps existing records only; it does not create semester records or reactivate mappings.
          </div>
        )}
        {selectedSemester && !sectionsQuery.isLoading && activeContextSections.length === 0 && (
          <p className="mt-2 rounded-lg bg-yellow-50 p-3 text-xs text-yellow-900">
            No active divisions exist for this exact term, program, scheme, and semester. Create or verify the applicable divisions in{' '}
            <Link className="font-semibold underline" to="/admin/academic-structure">Academic Structure</Link> before publishing term offerings.
          </p>
        )}
        <div className="mt-4 grid gap-3 md:grid-cols-5">
          <label className="text-sm"><span className="label">Academic year</span>
            <select className="input" value={selectedYear?.year_id ?? 0} onChange={event => {
              switchContext(value => { setYearId(value); setTermId(0); setSchemeId(0); setSemesterId(0); }, Number(event.target.value));
            }}>
              {activeYears.map(year => <option key={year.year_id} value={year.year_id}>{year.year_label}</option>)}
            </select>
          </label>
          <label className="text-sm"><span className="label">Term</span>
            <select className="input" value={selectedTerm?.term_id ?? 0} onChange={event => {
              switchContext(value => { setTermId(value); setSchemeId(0); setSemesterId(0); }, Number(event.target.value));
            }}>
              {termsForYear.map(term => <option key={term.term_id} value={term.term_id}>{term.term_name} · {term.parity}</option>)}
            </select>
          </label>
          <label className="text-sm"><span className="label">Program</span>
            <select className="input" value={selectedProgram?.program_id ?? 0} onChange={event => {
              switchContext(value => { setProgramId(value); setSchemeId(0); setSemesterId(0); }, Number(event.target.value));
            }}>
              {activePrograms.map(program => <option key={program.program_id} value={program.program_id}>{program.program_name}</option>)}
            </select>
          </label>
          <label className="text-sm"><span className="label">Curriculum scheme</span>
            <select className="input" value={selectedScheme?.scheme_id ?? 0} onChange={event => {
              switchContext(value => { setSchemeId(value); setSemesterId(0); }, Number(event.target.value));
            }}>
              {eligibleSchemes.map(scheme => <option key={scheme.scheme_id} value={scheme.scheme_id}>{scheme.scheme_code} · v{scheme.version}</option>)}
            </select>
          </label>
          <label className="text-sm"><span className="label">Semester</span>
            <select className="input" value={selectedSemester?.semester_id ?? 0} onChange={event => {
              switchContext(setSemesterId, Number(event.target.value));
            }}>
              {eligibleSemesters.map(semester => <option key={semester.semester_id} value={semester.semester_id}>
                Semester {semester.semester_no}{semester.name ? ` · ${semester.name}` : ''}
              </option>)}
            </select>
          </label>
        </div>
        <div className="mt-4 rounded-lg border border-gray-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Saved curriculum draft</h3>
              {draftQuery.isLoading && <p className="mt-1 text-xs text-gray-500">Checking this academic context…</p>}
              {draftQuery.error && <div className="mt-2"><ErrorMessage error={draftQuery.error} /></div>}
              {!draftQuery.isLoading && draftQuery.data?.available === false &&
                <p className="mt-1 text-xs text-amber-800">Draft persistence is unavailable until migration 009_curriculum_drafts.sql is applied. You can still use the existing validate and publish workflow.</p>}
              {!draftQuery.isLoading && draftQuery.data?.available && !currentSavedDraft &&
                <p className="mt-1 text-xs text-gray-500">No saved draft exists for the selected year, term, program, scheme, and semester.</p>}
              {currentSavedDraft && <p className="mt-1 text-xs text-gray-600">
                Version {currentSavedDraft.version} · Updated {new Date(currentSavedDraft.updated_at).toLocaleString()}
                {isCurrentDraftRestored ? ' · Restored in this editor' : ' · Restore before editing, validating, or publishing'}
              </p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {currentSavedDraft && <button type="button" className="btn-secondary btn-sm"
                disabled={draftQuery.isLoading || saveDraftMutation.isPending || deleteDraftMutation.isPending}
                onClick={restoreSavedDraft}>Restore saved draft</button>}
              <button type="button" className="btn-secondary btn-sm"
                disabled={!draftQuery.data?.available || draftQuery.isLoading || !!draftQuery.error
                  || (!!currentSavedDraft && !isCurrentDraftRestored)
                  || saveDraftMutation.isPending || deleteDraftMutation.isPending}
                onClick={saveCurrentDraft}>
                {saveDraftMutation.isPending ? 'Saving…' : currentSavedDraft ? 'Save changes' : 'Save draft'}
              </button>
              {currentSavedDraft && <button type="button" className="btn-ghost btn-sm text-red-600"
                disabled={deleteDraftMutation.isPending || saveDraftMutation.isPending}
                onClick={deleteSavedDraft}>
                {deleteDraftMutation.isPending ? 'Deleting…' : 'Delete saved draft'}
              </button>}
            </div>
          </div>
        </div>
        {!activeYears.length && <p className="mt-3 text-sm text-amber-700">Create an active academic year before building a curriculum.</p>}
        {activeYears.length > 0 && !termsForYear.length && <p className="mt-3 text-sm text-amber-700">No non-archived term is configured for this academic year.</p>}
        {!activePrograms.length && <p className="mt-3 text-sm text-amber-700">Create an active program before building a curriculum.</p>}
        {!!selectedProgram && !eligibleSchemes.length && <p className="mt-3 text-sm text-amber-700">No active curriculum scheme is configured for this program.</p>}
        {!mappingQuery.isLoading && mappingQuery.data?.mappingAvailable && !eligibleSemesters.length && !selectedScheme &&
          <p className="mt-3 text-sm text-amber-700">Select an active curriculum scheme to inspect its existing parity semester and term mapping records.</p>}
      </section>

      <section className="rounded-lg border border-indigo-100 bg-indigo-50 p-4 text-sm text-indigo-900">
        <p>A saved curriculum draft is not published. Publishing creates course, component, curriculum, offering, and selected-division audience records, all marked VERIFY for review.</p>
        {schedulingReadinessQuery.isLoading && <p className="mt-2 text-xs">Checking term scheduling configuration…</p>}
        {schedulingReadinessQuery.error && <div className="mt-2"><ErrorMessage error={schedulingReadinessQuery.error} title="Scheduling readiness check failed" /></div>}
        {schedulingReadinessQuery.data && <p className={`mt-2 text-xs ${schedulingReadinessQuery.data.ready ? 'text-green-800' : 'text-red-800'}`}>
          Term configuration: {schedulingReadinessQuery.data.ready ? 'ready according to the configuration check' : 'not ready'} ·
          {' '}{schedulingReadinessQuery.data.actual_divisions}/{schedulingReadinessQuery.data.expected_divisions} active divisions ·
          {' '}{schedulingReadinessQuery.data.rooms.length} active rooms ·
          {' '}mapped semester numbers {schedulingReadinessQuery.data.active_semesters.join(', ') || 'none'}.
        </p>}
        <p className="mt-1">This configuration check does not verify faculty assignments/preferences or availability; review those separately in{' '}
          <Link className="font-semibold underline" to="/admin/assignments">Assignments</Link> and{' '}
          <Link className="font-semibold underline" to="/admin/submissions">Faculty submissions</Link>.
          {' '}Curriculum publishing does not create or publish a timetable.{' '}
          <Link className="font-semibold underline" to="/admin/validation">Check scheduling configuration readiness</Link>.
          {' '}Automatic timetable generation is not available.</p>
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="w-44 text-sm"><span className="label">Number of subjects</span>
            <input className="input" type="number" min={1} max={100} value={countInput} onChange={event => { clearValidation(); setCountInput(event.target.value); }} />
          </label>
          <button type="button" className="btn-secondary" onClick={generateRows}>Generate editable rows</button>
          <span className="text-sm text-gray-500">{draft.length} draft row(s)</span>
        </div>

        <div className="mt-4 space-y-4">
          {draft.map((subject, index) => (
            <article key={index} className="rounded-lg border border-gray-200 p-4">
              <h3 className="font-medium">Subject {index + 1}</h3>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="text-sm"><span className="label">Subject code</span>
                  <input className="input" maxLength={30} value={subject.course_code} onChange={event => editSubject(index, { course_code: event.target.value })} />
                </label>
                <label className="text-sm"><span className="label">Subject name</span>
                  <input className="input" maxLength={200} value={subject.course_name} onChange={event => editSubject(index, { course_name: event.target.value })} />
                </label>
                <label className="text-sm"><span className="label">Category / type</span>
                  <input className="input" maxLength={20} value={subject.category} onChange={event => editSubject(index, { category: event.target.value })} placeholder="Optional" />
                </label>
                <label className="text-sm"><span className="label">Credits (optional)</span>
                  <input className="input" type="number" min={0} max={99.9} step={0.1} value={subject.credits} onChange={event => editSubject(index, { credits: event.target.value })} />
                </label>
                <label className="text-sm"><span className="label">Required weekly hours</span>
                  <input className="input" type="number" min={0.01} max={99.99} step={0.01} value={subject.required_weekly_hours} onChange={event => editSubject(index, { required_weekly_hours: event.target.value })} />
                </label>
                <label className="flex items-center gap-2 pt-6 text-sm">
                  <input type="checkbox" checked={subject.is_elective} onChange={event => editSubject(index, { is_elective: event.target.checked })} /> Elective
                </label>
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">Components — weekly hours must sum to the subject total</h4>
                  <button type="button" className="btn-secondary btn-sm" disabled={subject.components.length >= componentTypes.length} onClick={() => {
                    clearValidation();
                    setDraft(rows => rows.map((row, rowIndex) => rowIndex === index ? { ...row, components: [...row.components, blankComponent()] } : row));
                  }}>Add component</button>
                </div>
                {!subject.components.length && <p className="mt-2 text-sm text-gray-500">No components added yet.</p>}
                {subject.components.map((component, componentIndex) => (
                  <div key={componentIndex} className="mt-2 grid gap-2 rounded-md bg-gray-50 p-3 md:grid-cols-6">
                    <label className="text-xs"><span className="label">Type</span>
                      <select className="input" value={component.component_type} onChange={event => editComponent(index, componentIndex, { component_type: event.target.value as ComponentType })}>
                        <option value="">Select type</option>
                        {componentTypes.map(type => <option key={type} value={type}>{type}</option>)}
                      </select>
                    </label>
                    <label className="text-xs"><span className="label">Weekly hours</span>
                      <input className="input" type="number" min={0.01} max={99.99} step={0.01} value={component.weekly_hours} onChange={event => editComponent(index, componentIndex, { weekly_hours: event.target.value })} />
                    </label>
                    <label className="text-xs"><span className="label">Periods / session</span>
                      <input className="input" type="number" min={1} max={12} value={component.periods_per_session} onChange={event => editComponent(index, componentIndex, { periods_per_session: event.target.value })} />
                    </label>
                    <label className="text-xs"><span className="label">Required room type</span>
                      <select className="input" value={component.required_room_type_id} onChange={event => editComponent(index, componentIndex, { required_room_type_id: event.target.value })}>
                        <option value="">Not specified</option>
                        {roomTypes.filter(room => room.is_active).map(room => <option key={room.room_type_id} value={room.room_type_id}>{room.type_name}</option>)}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 pt-6 text-xs">
                      <input type="checkbox" checked={component.is_consecutive} onChange={event => editComponent(index, componentIndex, { is_consecutive: event.target.checked })} /> Consecutive
                    </label>
                    <button type="button" className="btn-ghost btn-sm self-end text-red-600" onClick={() => {
                      clearValidation();
                      setDraft(rows => rows.map((row, rowIndex) => rowIndex === index
                        ? { ...row, components: row.components.filter((_, itemIndex) => itemIndex !== componentIndex) } : row));
                    }}>Remove component</button>
                  </div>
                ))}
              </div>
              <fieldset className="mt-4 rounded-md border border-gray-200 p-3">
                <legend className="px-1 text-sm font-medium">Applicable divisions for this subject’s term offerings</legend>
                {!activeContextSections.length
                  ? <p className="text-xs text-amber-700">No active divisions are configured for this selected semester.</p>
                  : <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {activeContextSections.map(section => (
                      <label key={section.section_id} className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={subject.audience_section_ids.includes(section.section_id)}
                          onChange={event => editSubject(index, {
                            audience_section_ids: event.target.checked
                              ? [...subject.audience_section_ids, section.section_id]
                              : subject.audience_section_ids.filter(sectionId => sectionId !== section.section_id),
                          })}
                        />
                        <span>{section.section_name}{section.strength ? ` · ${section.strength} students` : ''}</span>
                        <StatusBadge status={section.data_status} />
                      </label>
                    ))}
                  </div>}
                {subject.audience_section_ids.some(sectionId => !activeContextSections.some(section => section.section_id === sectionId)) && (
                  <div className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
                    This saved draft refers to divisions that are no longer active in the selected context. Remove them before saving or publishing:
                    <div className="mt-1 flex flex-wrap gap-2">
                      {subject.audience_section_ids.filter(sectionId => !activeContextSections.some(section => section.section_id === sectionId)).map(sectionId => (
                        <button key={sectionId} type="button" className="underline"
                          onClick={() => editSubject(index, { audience_section_ids: subject.audience_section_ids.filter(id => id !== sectionId) })}>
                          Remove division {sectionId}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <p className="mt-2 text-xs text-gray-500">Choose divisions explicitly for each subject, including electives. Publishing creates one audience per selected division and component; these records remain VERIFY until reviewed.</p>
              </fieldset>
            </article>
          ))}
        </div>
        {formError && <div className="mt-4"><FormError message={formError} /></div>}
        {message && <p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">{message}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" className="btn-secondary" disabled={mappingQuery.isLoading || !mappingQuery.data?.mappingAvailable
            || draftQuery.isLoading || !!draftQuery.error || sectionsQuery.isLoading || validateMutation.isPending || publishMutation.isPending || saveDraftMutation.isPending} onClick={validateDraft}>
            {validateMutation.isPending ? 'Validating…' : 'Validate draft'}
          </button>
          <button type="button" className="btn-primary" disabled={!validated || publishMutation.isPending || validateMutation.isPending
            || draftQuery.isLoading || !!draftQuery.error || (!!currentSavedDraft && !isCurrentDraftRestored) || saveDraftMutation.isPending}
            onClick={() => validated && publishMutation.mutate({ payload: validated, revision: draftRevision.current, subjects: draft })}>
            {publishMutation.isPending ? 'Publishing…' : 'Publish curriculum'}
          </button>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-semibold">Saved subjects for selected semester</h2>
        <DataTable<CurriculumCourse> columns={[
          { header: 'Code', accessor: row => courseById.get(row.course_id)?.course_code ?? '—' },
          { header: 'Subject', accessor: row => courseById.get(row.course_id)?.course_name ?? `Course ${row.course_id}` },
          { header: 'Credits', accessor: row => courseById.get(row.course_id)?.credits ?? '—' },
          { header: 'Category', accessor: row => courseById.get(row.course_id)?.category ?? '—' },
          { header: 'Components', accessor: row => savedComponents.filter(component => component.course_id === row.course_id).map(component => component.component_type).join(', ') || '—' },
          { header: 'Weekly hours', accessor: row => savedComponents.filter(component => component.course_id === row.course_id).reduce((sum, component) => sum + Number(component.weekly_hours ?? 0), 0) || '—' },
          { header: 'Curriculum', accessor: row => <Badge variant={courseById.get(row.course_id)?.is_active ? 'green' : 'gray'}>
            {courseById.get(row.course_id)?.is_active ? 'Published' : 'Inactive'}
          </Badge> },
          { header: 'Data status', accessor: row => <StatusBadge status={courseById.get(row.course_id)?.data_status ?? 'UNKNOWN'} /> },
        ]} data={savedRows} keyField="curriculum_course_id" loading={savedQuery.isLoading} emptyTitle="No saved subjects for this semester" />
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-semibold">Term offerings and division audiences</h2>
        <p className="mt-1 text-sm text-gray-600">Offerings are shown separately from the semester curriculum. Each row reports its term status, review status, and divisions connected through the existing audience model.</p>
        <DataTable<CourseOffering> columns={[
          { header: 'Course component', accessor: offering => {
            const component = componentById.get(offering.component_id);
            const course = component ? courseById.get(component.course_id) : undefined;
            return component ? `${course?.course_code ?? course?.course_name ?? `Course ${component.course_id}`} · ${component.component_type}` : `Component ${offering.component_id}`;
          } },
          { header: 'Term', accessor: offering => terms.find(term => term.term_id === offering.term_id)?.term_name ?? `Term ${offering.term_id}` },
          { header: 'Offering status', accessor: offering => <StatusBadge status={offering.status} /> },
          { header: 'Data status', accessor: offering => <StatusBadge status={offering.data_status} /> },
          { header: 'Division audiences', accessor: offering => {
            const related = audienceByOffering.get(offering.offering_id) ?? [];
            return related.length
              ? related.map(audience => {
                const section = sectionById.get(audience.section_id);
                return `${section?.section_name ?? `Division ${audience.section_id}`}${audience.batch_id ? ` · Batch ${audience.batch_id}` : ''}`;
              }).join(', ')
              : <span className="text-amber-700">No divisions linked</span>;
          } },
        ]} data={publishedOfferings} keyField="offering_id" loading={offeringsQuery.isLoading || audiencesQuery.isLoading}
          emptyTitle="No offerings for the selected semester and term"
          emptyDescription="Publish validated curriculum to create term offerings and the explicitly selected division audiences." />
      </section>
    </div>
  );
}
