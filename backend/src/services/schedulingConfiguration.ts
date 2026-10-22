import { dayLatestEnd, SCHEDULING_POLICY } from '../rules/scheduleRules';

export type SchedulingIssue = {
  severity: 'ERROR' | 'WARNING';
  rule_code: string;
  message: string;
  details: Record<string, unknown>;
};

export interface ConfiguredSlot {
  slot_id: number;
  slot_no: number;
  start_time: string;
  end_time: string;
  slot_type: 'TEACHING' | 'BREAK' | 'LUNCH';
  data_status: string;
}

export interface ConfiguredDay {
  day_name: string;
  is_teaching_day: boolean;
  closing_time: string | null;
  slots: ConfiguredSlot[];
}

export interface ConfiguredRoom {
  room_id: number;
  room_code: string;
  type_code: string;
  capacity: number | null;
  equipment: string | null;
  data_status: string;
  practical_approved: boolean;
  availability: Array<AvailabilityWindow & { day_name: string }>;
}

export interface ConfiguredDivision {
  section_id: number;
  section_name: string;
  semester_no: number;
  program_code: string;
  data_status: string;
}

export interface SchedulingConfiguration {
  term_id: number;
  parity: 'ODD' | 'EVEN';
  mapped_semester_numbers: number[];
  active_division_counts: Record<number, number>;
  active_divisions: ConfiguredDivision[];
  rooms: ConfiguredRoom[];
  days: ConfiguredDay[];
  practical_approval_supported: boolean;
  calendar_supported: boolean;
  workload_rule_count: number;
  verified_workload_rule_count: number;
}

export interface AvailabilityWindow {
  start_time: string;
  end_time: string;
  availability_type: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
}

export function expectedSemesters(parity: 'ODD' | 'EVEN'): number[] {
  return parity === 'ODD' ? [3, 5, 7] : [4, 6, 8];
}

function issue(rule_code: string, message: string, details: Record<string, unknown> = {}): SchedulingIssue {
  return { severity: 'ERROR', rule_code, message, details };
}

function overlaps(startA: string, endA: string, startB: string, endB: string): boolean {
  return startA < endB && startB < endA;
}

function durationMinutes(start: string, end: string): number {
  const minutes = (value: string) => {
    const [hours, mins, seconds = '0'] = value.split(':');
    return Number(hours) * 60 + Number(mins) + Number(seconds) / 60;
  };
  return minutes(end) - minutes(start);
}

function isVerified(status: string): boolean {
  return status === 'VERIFIED' || status === 'RESOLVED';
}

export function validateSchedulingConfiguration(config: SchedulingConfiguration): SchedulingIssue[] {
  const issues: SchedulingIssue[] = [];
  const semesters = expectedSemesters(config.parity);
  const mapped = [...new Set(config.mapped_semester_numbers)].sort((a, b) => a - b);
  if (JSON.stringify(mapped) !== JSON.stringify(semesters)) {
    issues.push(issue(
      'TERM_SEMESTER_MAPPING',
      `${config.parity} terms must map exactly semesters ${semesters.join(', ')}.`,
      { expected: semesters, actual: mapped },
    ));
  }

  for (const semester of semesters) {
    const count = config.active_division_counts[semester] ?? 0;
    if (count !== SCHEDULING_POLICY.divisionsPerSemester) {
      issues.push(issue(
        'DIVISION_COUNT',
        `Semester ${semester} requires ${SCHEDULING_POLICY.divisionsPerSemester} active divisions; found ${count}.`,
        { semester_no: semester, expected: SCHEDULING_POLICY.divisionsPerSemester, actual: count },
      ));
    }
  }
  for (const division of config.active_divisions) {
    if (!isVerified(division.data_status)) {
      issues.push(issue(
        'DIVISION_NOT_VERIFIED',
        `Division ${division.section_name} (${division.program_code}, semester ${division.semester_no}) is ${division.data_status}.`,
        { section_id: division.section_id, semester_no: division.semester_no, data_status: division.data_status },
      ));
    }
  }
  const unexpectedDivisions = Object.entries(config.active_division_counts)
    .filter(([semester, count]) => count > 0 && !semesters.includes(Number(semester)));
  if (unexpectedDivisions.length) {
    issues.push(issue(
      'DIVISION_SEMESTER_PARITY',
      `Active divisions are configured outside the ${config.parity} semester set.`,
      { unexpected: unexpectedDivisions.map(([semester_no, count]) => ({ semester_no: Number(semester_no), count })) },
    ));
  }

  const classrooms = config.rooms.filter(room => room.type_code === 'CLASSROOM');
  const labs = config.rooms.filter(room => room.type_code === 'LAB');
  const otherRooms = config.rooms.filter(room => room.type_code !== 'CLASSROOM' && room.type_code !== 'LAB');
  for (const [type, actual, expected] of [
    ['classroom', classrooms.length, SCHEDULING_POLICY.classroomCount],
    ['dedicated lab', labs.length, SCHEDULING_POLICY.labCount],
  ] as const) {
    if (actual !== expected) {
      issues.push(issue(
        'ROOM_INVENTORY_COUNT',
        `Expected ${expected} active ${type} resources shared across terms; found ${actual}.`,
        { resource_type: type, expected, actual },
      ));
    }
  }
  if (otherRooms.length) {
    issues.push(issue(
      'ROOM_TYPE_UNCLASSIFIED',
      'Every active scheduling room must be classified as CLASSROOM or LAB.',
      { room_ids: otherRooms.map(room => room.room_id) },
    ));
  }
  if (!config.practical_approval_supported) {
    issues.push(issue(
      'ROOM_PRACTICAL_CONFIGURATION_UNAVAILABLE',
      'The schema cannot record explicit approval for classroom practicals; apply the room suitability migration before scheduling.',
    ));
  }
  for (const room of config.rooms) {
    if (!isVerified(room.data_status)) {
      issues.push(issue(
        'ROOM_NOT_VERIFIED',
        `Room ${room.room_code} is ${room.data_status}; inventory details are not approved for scheduling.`,
        { room_id: room.room_id, data_status: room.data_status },
      ));
    }
    if (room.capacity == null || room.capacity <= 0) {
      issues.push(issue('ROOM_CAPACITY_MISSING', `Room ${room.room_code} needs a verified positive capacity.`, { room_id: room.room_id }));
    }
    if (!room.equipment?.trim()) {
      issues.push(issue('ROOM_EQUIPMENT_MISSING', `Room ${room.room_code} has no equipment/features recorded.`, { room_id: room.room_id }));
    }
  }

  const dayMap = new Map(config.days.map(day => [day.day_name, day]));
  for (const weekday of ['MON', 'TUE', 'WED', 'THU', 'FRI']) {
    const day = dayMap.get(weekday);
    if (!day?.is_teaching_day) {
      issues.push(issue('WEEKDAY_NOT_CONFIGURED', `${weekday} must be configured as a teaching day.`));
      continue;
    }
    if (!day.slots.some(slot =>
      slot.slot_type === 'LUNCH' &&
      slot.start_time === SCHEDULING_POLICY.lunchStart &&
      slot.end_time === SCHEDULING_POLICY.lunchEnd)) {
      issues.push(issue(
        'LUNCH_NOT_CONFIGURED',
        `${weekday} needs the configured lunch interval ${SCHEDULING_POLICY.lunchStart}–${SCHEDULING_POLICY.lunchEnd}.`,
        { day: weekday },
      ));
    }
  }

  for (const day of config.days) {
    const latestEnd = dayLatestEnd(day.day_name, day.closing_time);
    const sorted = [...day.slots].sort((a, b) => a.start_time.localeCompare(b.start_time));
    if (day.is_teaching_day && !day.slots.some(slot => slot.slot_type === 'TEACHING')) {
      issues.push(issue(
        'TEACHING_SLOTS_MISSING',
        `${day.day_name} is configured as a teaching day but has no teaching slots.`,
        { day: day.day_name },
      ));
    }
    for (const slot of sorted) {
      if (!isVerified(slot.data_status)) {
        issues.push(issue(
          'TEACHING_SLOT_NOT_VERIFIED',
          `${day.day_name} slot ${slot.slot_no} is ${slot.data_status}.`,
          { day: day.day_name, slot_id: slot.slot_id, data_status: slot.data_status },
        ));
      }
      if (slot.slot_type === 'TEACHING') {
        const earliest = SCHEDULING_POLICY.dayStart;
        const dailyEnd = day.day_name === 'SAT'
          ? SCHEDULING_POLICY.saturdayLatestEnd
          : SCHEDULING_POLICY.weekdayLatestEnd;
        if (slot.start_time < earliest || slot.end_time > dailyEnd || (latestEnd && slot.end_time > latestEnd)) {
          issues.push(issue(
            day.day_name === 'SAT' ? 'SATURDAY_CUTOFF' : 'OPERATING_HOURS',
            `${day.day_name} teaching slot ${slot.slot_no} is outside permitted operating hours.`,
            { day: day.day_name, slot_id: slot.slot_id, start_time: slot.start_time, end_time: slot.end_time, latest_end: latestEnd ?? dailyEnd },
          ));
        }
        if (durationMinutes(slot.start_time, slot.end_time) !== SCHEDULING_POLICY.periodMinutes) {
          issues.push(issue(
            'TEACHING_PERIOD_DURATION',
            `${day.day_name} teaching slot ${slot.slot_no} must be ${SCHEDULING_POLICY.periodMinutes} minutes.`,
            { day: day.day_name, slot_id: slot.slot_id, start_time: slot.start_time, end_time: slot.end_time },
          ));
        }
      }
    }
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (!overlaps(sorted[i].start_time, sorted[i].end_time, sorted[j].start_time, sorted[j].end_time)) continue;
        issues.push(issue(
          'SLOT_OVERLAP',
          `${day.day_name} slots ${sorted[i].slot_no} and ${sorted[j].slot_no} overlap.`,
          { day: day.day_name, slot_ids: [sorted[i].slot_id, sorted[j].slot_id] },
        ));
      }
    }
    for (const teaching of sorted.filter(slot => slot.slot_type === 'TEACHING')) {
      for (const pause of sorted.filter(slot => slot.slot_type !== 'TEACHING')) {
        if (overlaps(teaching.start_time, teaching.end_time, pause.start_time, pause.end_time)) {
          issues.push(issue(
            'TEACHING_DURING_BREAK',
            `${day.day_name} teaching slot ${teaching.slot_no} overlaps ${pause.slot_type.toLowerCase()} slot ${pause.slot_no}.`,
            { day: day.day_name, teaching_slot_id: teaching.slot_id, break_slot_id: pause.slot_id },
          ));
        }
      }
    }
  }

  for (const room of config.rooms) {
    for (const day of config.days.filter(entry => entry.is_teaching_day)) {
      const roomWindows = room.availability.filter(window => window.day_name === day.day_name);
      for (const teachingSlot of day.slots.filter(slot => slot.slot_type === 'TEACHING')) {
        const overlapsSlot = roomWindows.filter(window =>
          overlaps(teachingSlot.start_time, teachingSlot.end_time, window.start_time, window.end_time));
        if (overlapsSlot.some(window => window.availability_type === 'UNKNOWN')) {
          issues.push(issue(
            'ROOM_AVAILABILITY_UNKNOWN',
            `Availability for room ${room.room_code} is UNKNOWN during ${day.day_name} slot ${teachingSlot.slot_no}.`,
            { room_id: room.room_id, day: day.day_name, slot_id: teachingSlot.slot_id },
          ));
        }
        const coveringWindows = roomWindows
          .filter(window => window.end_time > teachingSlot.start_time && window.start_time < teachingSlot.end_time)
          .map(window => ({ start: window.start_time, end: window.end_time }))
          .sort((a, b) => a.start.localeCompare(b.start));
        let coveredUntil = teachingSlot.start_time;
        for (const window of coveringWindows) {
          if (window.end <= coveredUntil || window.start > coveredUntil) continue;
          coveredUntil = window.end;
          if (coveredUntil >= teachingSlot.end_time) break;
        }
        if (coveredUntil < teachingSlot.end_time) {
          issues.push(issue(
            'ROOM_AVAILABILITY_MISSING',
            `Room ${room.room_code} has no explicit availability coverage for ${day.day_name} slot ${teachingSlot.slot_no}.`,
            { room_id: room.room_id, day: day.day_name, slot_id: teachingSlot.slot_id },
          ));
        }
        if (overlapsSlot.some(window => window.availability_type === 'AVAILABLE') &&
            overlapsSlot.some(window => window.availability_type === 'UNAVAILABLE')) {
          issues.push(issue(
            'ROOM_AVAILABILITY_CONFLICT',
            `Room ${room.room_code} has conflicting AVAILABLE and UNAVAILABLE windows during ${day.day_name} slot ${teachingSlot.slot_no}.`,
            { room_id: room.room_id, day: day.day_name, slot_id: teachingSlot.slot_id },
          ));
        }
      }
    }
  }

  if (!config.calendar_supported) {
    issues.push(issue(
      'CALENDAR_UNSUPPORTED',
      'Holiday and examination-day restrictions cannot be validated because academic calendar support is not installed.',
    ));
  }
  if (config.verified_workload_rule_count === 0) {
    issues.push(issue(
      'VERIFIED_WORKLOAD_POLICY_MISSING',
      'No active VERIFIED faculty workload limit is configured; workload feasibility cannot be established.',
      { active_rule_count: config.workload_rule_count },
    ));
  }
  if (config.verified_workload_rule_count < config.workload_rule_count) {
    issues.push(issue(
      'UNVERIFIED_WORKLOAD_POLICY',
      'One or more active workload rules are not VERIFIED and cannot be treated as institutional limits.',
      { active_rule_count: config.workload_rule_count, verified_rule_count: config.verified_workload_rule_count },
    ));
  }
  return issues;
}

export interface SessionGridInput {
  day_name: string;
  start_time: string;
  end_time: string;
  start_slot_id: number | null;
  slot_count: number | null;
}

export function validateSessionGrid(session: SessionGridInput, day: ConfiguredDay | undefined): SchedulingIssue[] {
  const issues: SchedulingIssue[] = [];
  if (!day?.is_teaching_day) {
    return [issue('NOT_A_TEACHING_DAY', `${session.day_name} is not configured as a teaching day.`, { day: session.day_name })];
  }
  const latestEnd = dayLatestEnd(session.day_name, day.closing_time) ??
    (session.day_name === 'SAT' ? SCHEDULING_POLICY.saturdayLatestEnd : SCHEDULING_POLICY.weekdayLatestEnd);
  if (session.start_time < SCHEDULING_POLICY.dayStart || session.end_time > latestEnd ||
      (session.day_name === 'SAT' && session.end_time > SCHEDULING_POLICY.saturdayLatestEnd)) {
    issues.push(issue(
      session.day_name === 'SAT' ? 'SATURDAY_CUTOFF' : 'OPERATING_HOURS',
      `Session is outside permitted operating hours on ${session.day_name}.`,
      { day: session.day_name, start_time: session.start_time, end_time: session.end_time, latest_end: latestEnd },
    ));
  }
  for (const pause of day.slots.filter(slot => slot.slot_type !== 'TEACHING')) {
    if (overlaps(session.start_time, session.end_time, pause.start_time, pause.end_time)) {
      issues.push(issue(
        'SESSION_BREAK_CONFLICT',
        `Session overlaps the configured ${pause.slot_type.toLowerCase()} on ${session.day_name}.`,
        { slot_id: pause.slot_id, slot_type: pause.slot_type, day: session.day_name },
      ));
    }
  }

  const activeTeaching = day.slots
    .filter(slot => slot.slot_type === 'TEACHING')
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const startIndex = activeTeaching.findIndex(slot =>
    slot.slot_id === session.start_slot_id && slot.start_time === session.start_time);
  if (session.start_slot_id == null || session.slot_count == null || session.slot_count < 1 || startIndex < 0) {
    issues.push(issue(
      'INVALID_TEACHING_SLOT',
      'Session must identify a configured active teaching slot and a positive slot count.',
      { start_slot_id: session.start_slot_id, slot_count: session.slot_count },
    ));
  } else {
    const selected = activeTeaching.slice(startIndex, startIndex + session.slot_count);
    const isContinuous = selected.length === session.slot_count &&
      selected.every((slot, index) => index === 0 || selected[index - 1].end_time === slot.start_time);
    if (!isContinuous || selected[0]?.start_time !== session.start_time ||
        selected[selected.length - 1]?.end_time !== session.end_time) {
      issues.push(issue(
        'INVALID_TEACHING_SLOT',
        'Session interval must exactly match consecutive active teaching slots without crossing a gap or break.',
        { start_slot_id: session.start_slot_id, slot_count: session.slot_count, session_start: session.start_time, session_end: session.end_time },
      ));
    }
  }
  return issues;
}

export function validateAvailability(
  start: string,
  end: string,
  windows: AvailabilityWindow[],
  resourceLabel: string,
): SchedulingIssue[] {
  const issues: SchedulingIssue[] = [];
  for (const window of windows) {
    if (!overlaps(start, end, window.start_time, window.end_time)) continue;
    if (window.availability_type === 'UNAVAILABLE' || window.availability_type === 'UNKNOWN') {
      issues.push(issue(
        window.availability_type === 'UNKNOWN' ? 'UNKNOWN_AVAILABILITY' : 'UNAVAILABLE',
        `${resourceLabel} has ${window.availability_type.toLowerCase()} availability during the session.`,
        { availability_type: window.availability_type, window_start: window.start_time, window_end: window.end_time },
      ));
    }
  }
  const available = windows
    .filter(window => window.availability_type === 'AVAILABLE')
    .map(window => ({ start: window.start_time, end: window.end_time }))
    .sort((a, b) => a.start.localeCompare(b.start));
  let coveredUntil = start;
  for (const window of available) {
    if (window.end <= coveredUntil || window.start > coveredUntil) continue;
    coveredUntil = window.end;
    if (coveredUntil >= end) break;
  }
  if (coveredUntil < end) {
    issues.push(issue(
      'UNKNOWN_AVAILABILITY',
      `${resourceLabel} does not have explicit AVAILABLE coverage for the entire session; missing availability is blocked.`,
      { session_start: start, session_end: end },
    ));
  }
  return issues;
}

export function validateRoomCapacity(capacity: number | null, plannedStrength: number | null): SchedulingIssue[] {
  if (capacity == null || capacity <= 0) {
    return [issue('ROOM_CAPACITY_MISSING', 'Room capacity is missing or invalid.', { capacity })];
  }
  if (plannedStrength == null || plannedStrength <= 0) {
    return [issue('AUDIENCE_STRENGTH_MISSING', 'Audience strength is missing; room capacity cannot be verified.', { planned_strength: plannedStrength })];
  }
  if (plannedStrength > capacity) {
    return [issue(
      'ROOM_CAPACITY',
      `Planned audience strength ${plannedStrength} exceeds room capacity ${capacity}.`,
      { capacity, planned_strength: plannedStrength },
    )];
  }
  return [];
}

export function resolveAudienceStrength(input: {
  offering_audience_strength: number | null;
  section_strength: number | null;
  batch_strength: number | null;
  batch_id: number | null;
}): number | null {
  if (input.offering_audience_strength != null) return input.offering_audience_strength;
  return input.batch_id == null ? input.section_strength : input.batch_strength;
}

export function resolveTotalAudienceStrength(strengths: Array<number | null>): number | null {
  if (!strengths.length || !strengths.every((strength): strength is number => strength != null)) return null;
  return strengths.reduce((total, strength) => total + strength, 0);
}

export function validateSessionAudienceScope(audiences: Array<{
  section_id: number;
  batch_id: number | null;
}>): SchedulingIssue[] {
  const sectionIds = new Set(audiences.map(audience => audience.section_id));
  const issues: SchedulingIssue[] = [];
  if (sectionIds.size > 1) {
    issues.push(issue(
      'SHARED_DIVISION_SESSION',
      'A scheduled session cannot combine multiple divisions.',
      { section_ids: [...sectionIds] },
    ));
  }
  if ([...sectionIds].some(sectionId => {
    const sectionAudiences = audiences.filter(audience => audience.section_id === sectionId);
    return sectionAudiences.some(audience => audience.batch_id == null) &&
      sectionAudiences.some(audience => audience.batch_id != null);
  })) {
    issues.push(issue(
      'AUDIENCE_SCOPE_CONFLICT',
      'A session cannot include both a whole division and batches from that division.',
    ));
  }
  return issues;
}

export function validateRoomSuitability(input: {
  component_type: string;
  room_type_code: string;
  required_room_type_code: string | null;
  practical_approved: boolean;
  room_status: string;
}): SchedulingIssue[] {
  const issues: SchedulingIssue[] = [];
  if (input.required_room_type_code && input.room_type_code !== input.required_room_type_code) {
    issues.push(issue('ROOM_TYPE_MISMATCH', 'Room type does not satisfy the component requirement.'));
  }
  if (input.component_type === 'LAB' && input.room_type_code !== 'LAB' &&
      !(input.room_type_code === 'CLASSROOM' && input.practical_approved && isVerified(input.room_status))) {
    issues.push(issue(
      'PRACTICAL_ROOM_NOT_APPROVED',
      'A classroom may host practical work only when explicitly approved and the room data is verified.',
    ));
  }
  if (!isVerified(input.room_status)) {
    issues.push(issue('ROOM_NOT_VERIFIED', 'Room suitability cannot be established from unverified room data.', { room_status: input.room_status }));
  }
  return issues;
}

export function validateConsecutivePeriods(input: {
  is_consecutive: boolean;
  periods_per_session: number | null;
  slot_count: number | null;
}): SchedulingIssue[] {
  if (!input.is_consecutive) return [];
  if (input.periods_per_session == null || input.periods_per_session < 2) {
    return [issue('LAB_PERIODS_MISSING', 'A consecutive component must configure at least two periods per session.')];
  }
  if (input.slot_count !== input.periods_per_session) {
    return [issue(
      'LAB_PERIOD_COUNT_MISMATCH',
      'Consecutive session slot count must match the component period requirement.',
      { expected: input.periods_per_session, actual: input.slot_count },
    )];
  }
  return [];
}
