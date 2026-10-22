import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ConfiguredDay,
  ConfiguredRoom,
  expectedSemesters,
  resolveAudienceStrength,
  resolveTotalAudienceStrength,
  SchedulingConfiguration,
  validateAvailability,
  validateConsecutivePeriods,
  validateRoomCapacity,
  validateRoomSuitability,
  validateSessionAudienceScope,
  validateSchedulingConfiguration,
  validateSessionGrid,
} from '../src/services/schedulingConfiguration';

const verifiedRoom = (room_id: number, type_code: 'CLASSROOM' | 'LAB'): ConfiguredRoom => ({
  room_id,
  room_code: `ROOM-${room_id}`,
  type_code,
  capacity: 60,
  equipment: 'Verified equipment list',
  data_status: 'VERIFIED',
  practical_approved: false,
  availability: ['MON', 'TUE', 'WED', 'THU', 'FRI'].map(day_name => ({
    day_name,
    start_time: '08:00:00',
    end_time: '09:00:00',
    availability_type: 'AVAILABLE' as const,
  })),
});

const standardDays = (): ConfiguredDay[] => ['MON', 'TUE', 'WED', 'THU', 'FRI'].map((day, index) => ({
  day_name: day,
  is_teaching_day: true,
  closing_time: '17:30:00',
  slots: [
    { slot_id: index * 2 + 1, slot_no: 1, start_time: '08:00:00', end_time: '09:00:00', slot_type: 'TEACHING', data_status: 'VERIFIED' },
    { slot_id: index * 2 + 2, slot_no: 2, start_time: '12:30:00', end_time: '13:30:00', slot_type: 'LUNCH', data_status: 'VERIFIED' },
  ],
}));

const validConfig = (parity: 'ODD' | 'EVEN' = 'ODD'): SchedulingConfiguration => {
  const semesters = expectedSemesters(parity);
  return {
    term_id: 1,
    parity,
    mapped_semester_numbers: semesters,
    active_division_counts: Object.fromEntries(semesters.map(semester => [semester, 4])),
    active_divisions: semesters.flatMap(semester => Array.from({ length: 4 }, (_, index) => ({
      section_id: semester * 10 + index,
      section_name: `DIV-${semester}-${index}`,
      semester_no: semester,
      program_code: index === 3 ? 'CSE_AI' : 'CSE',
      data_status: 'VERIFIED',
    }))),
    rooms: [
      ...Array.from({ length: 8 }, (_, i) => verifiedRoom(i + 1, 'CLASSROOM')),
      ...Array.from({ length: 4 }, (_, i) => verifiedRoom(i + 9, 'LAB')),
    ],
    days: standardDays(),
    practical_approval_supported: true,
    calendar_supported: true,
    workload_rule_count: 1,
    verified_workload_rule_count: 1,
  };
};

const slot = (overrides: Partial<ConfiguredDay> = {}): ConfiguredDay => ({
  day_name: 'MON',
  is_teaching_day: true,
  closing_time: '17:30:00',
  slots: [
    { slot_id: 1, slot_no: 1, start_time: '08:00:00', end_time: '09:00:00', slot_type: 'TEACHING', data_status: 'VERIFIED' },
    { slot_id: 2, slot_no: 2, start_time: '09:00:00', end_time: '10:00:00', slot_type: 'TEACHING', data_status: 'VERIFIED' },
    { slot_id: 3, slot_no: 3, start_time: '12:30:00', end_time: '13:30:00', slot_type: 'LUNCH', data_status: 'VERIFIED' },
  ],
  ...overrides,
});

test('valid odd and even term configurations use their parity semester sets', () => {
  assert.deepEqual(validateSchedulingConfiguration(validConfig('ODD')), []);
  assert.deepEqual(validateSchedulingConfiguration(validConfig('EVEN')), []);
});

test('rejects incorrect section counts and semester mappings', () => {
  const config = validConfig();
  config.active_division_counts[5] = 3;
  config.mapped_semester_numbers = [3, 5, 6];
  const issues = validateSchedulingConfiguration(config);
  assert.ok(issues.some(issue => issue.rule_code === 'DIVISION_COUNT'));
  assert.ok(issues.some(issue => issue.rule_code === 'TERM_SEMESTER_MAPPING'));
});

test('requires eight classrooms and four shared dedicated labs with verified details', () => {
  const config = validConfig();
  config.rooms.pop();
  config.rooms[0].data_status = 'SYNTHETIC';
  config.rooms[1].capacity = null;
  const issues = validateSchedulingConfiguration(config);
  assert.ok(issues.some(issue => issue.rule_code === 'ROOM_INVENTORY_COUNT'));
  assert.ok(issues.some(issue => issue.rule_code === 'ROOM_NOT_VERIFIED'));
  assert.ok(issues.some(issue => issue.rule_code === 'ROOM_CAPACITY_MISSING'));
});

test('requires weekday grids, lunch, and exact standard teaching-period duration', () => {
  const config = validConfig();
  config.days[0].slots[0].end_time = '10:00:00';
  config.days[1].slots = config.days[1].slots.filter(item => item.slot_type !== 'LUNCH');
  config.days = config.days.filter(day => day.day_name !== 'FRI');
  const issues = validateSchedulingConfiguration(config);
  assert.ok(issues.some(issue => issue.rule_code === 'TEACHING_PERIOD_DURATION'));
  assert.ok(issues.some(issue => issue.rule_code === 'LUNCH_NOT_CONFIGURED'));
  assert.ok(issues.some(issue => issue.rule_code === 'WEEKDAY_NOT_CONFIGURED'));
});

test('requires at least one teaching slot for every configured teaching day', () => {
  const config = validConfig();
  config.days[0].slots = config.days[0].slots.filter(item => item.slot_type !== 'TEACHING');
  assert.ok(validateSchedulingConfiguration(config).some(issue => issue.rule_code === 'TEACHING_SLOTS_MISSING'));
});

test('validates operating hours, break overlaps, Sunday configuration, and teaching slot membership', () => {
  const day = slot();
  const late = validateSessionGrid({
    day_name: 'MON', start_time: '17:00:00', end_time: '18:00:00', start_slot_id: 9, slot_count: 1,
  }, day);
  assert.ok(late.some(issue => issue.rule_code === 'OPERATING_HOURS'));
  assert.ok(late.some(issue => issue.rule_code === 'INVALID_TEACHING_SLOT'));

  const lunchConflict = validateSessionGrid({
    day_name: 'MON', start_time: '12:00:00', end_time: '13:00:00', start_slot_id: 1, slot_count: 1,
  }, day);
  assert.ok(lunchConflict.some(issue => issue.rule_code === 'SESSION_BREAK_CONFLICT'));

  const sunday = validateSessionGrid({
    day_name: 'SUN', start_time: '08:00:00', end_time: '09:00:00', start_slot_id: 1, slot_count: 1,
  }, { ...day, day_name: 'SUN', is_teaching_day: false });
  assert.ok(sunday.some(issue => issue.rule_code === 'NOT_A_TEACHING_DAY'));

  const saturday = validateSessionGrid({
    day_name: 'SAT', start_time: '12:00:00', end_time: '13:00:00', start_slot_id: 1, slot_count: 1,
  }, { ...day, day_name: 'SAT', closing_time: '12:30:00' });
  assert.ok(saturday.some(issue => issue.rule_code === 'SATURDAY_CUTOFF'));
});

test('blocks missing, UNKNOWN, and UNAVAILABLE faculty/room windows; permits explicit full availability', () => {
  const missing = validateAvailability('09:00:00', '10:00:00', [], 'Faculty 1');
  assert.ok(missing.some(issue => issue.rule_code === 'UNKNOWN_AVAILABILITY'));
  const unknown = validateAvailability('09:00:00', '10:00:00', [
    { start_time: '08:00:00', end_time: '12:00:00', availability_type: 'UNKNOWN' },
  ], 'Room 1');
  assert.ok(unknown.some(issue => issue.rule_code === 'UNKNOWN_AVAILABILITY'));
  const unavailable = validateAvailability('09:00:00', '10:00:00', [
    { start_time: '08:00:00', end_time: '12:00:00', availability_type: 'UNAVAILABLE' },
  ], 'Faculty 1');
  assert.ok(unavailable.some(issue => issue.rule_code === 'UNAVAILABLE'));
  assert.deepEqual(validateAvailability('09:00:00', '10:00:00', [
    { start_time: '08:00:00', end_time: '09:30:00', availability_type: 'AVAILABLE' },
    { start_time: '09:30:00', end_time: '10:00:00', availability_type: 'AVAILABLE' },
  ], 'Faculty 1'), []);
});

test('capacity excess and missing size are blocking; classroom practical needs explicit approval', () => {
  assert.ok(validateRoomCapacity(20, 21).some(issue => issue.rule_code === 'ROOM_CAPACITY'));
  assert.ok(validateRoomCapacity(null, 20).some(issue => issue.rule_code === 'ROOM_CAPACITY_MISSING'));
  assert.ok(validateRoomCapacity(20, null).some(issue => issue.rule_code === 'AUDIENCE_STRENGTH_MISSING'));
  assert.ok(validateRoomSuitability({
    component_type: 'LAB', room_type_code: 'CLASSROOM', required_room_type_code: null,
    practical_approved: false, room_status: 'VERIFIED',
  }).some(issue => issue.rule_code === 'PRACTICAL_ROOM_NOT_APPROVED'));
  assert.deepEqual(validateRoomSuitability({
    component_type: 'LAB', room_type_code: 'CLASSROOM', required_room_type_code: null,
    practical_approved: true, room_status: 'VERIFIED',
  }), []);
});

test('batch sessions use batch strength instead of a whole-section fallback', () => {
  assert.equal(resolveAudienceStrength({
    offering_audience_strength: null,
    section_strength: 60,
    batch_strength: 20,
    batch_id: 3,
  }), 20);
  assert.equal(resolveAudienceStrength({
    offering_audience_strength: 18,
    section_strength: 60,
    batch_strength: 20,
    batch_id: 3,
  }), 18);
});

test('capacity uses the combined strength of all scheduled audience groups', () => {
  assert.equal(resolveTotalAudienceStrength([18, 20]), 38);
  assert.equal(resolveTotalAudienceStrength([18, null]), null);
  assert.equal(resolveTotalAudienceStrength([]), null);
});

test('a session cannot combine divisions or a whole division with its batches', () => {
  assert.ok(validateSessionAudienceScope([
    { section_id: 1, batch_id: null },
    { section_id: 2, batch_id: null },
  ]).some(issue => issue.rule_code === 'SHARED_DIVISION_SESSION'));
  assert.ok(validateSessionAudienceScope([
    { section_id: 1, batch_id: null },
    { section_id: 1, batch_id: 5 },
  ]).some(issue => issue.rule_code === 'AUDIENCE_SCOPE_CONFLICT'));
  assert.deepEqual(validateSessionAudienceScope([
    { section_id: 1, batch_id: 5 },
    { section_id: 1, batch_id: 6 },
  ]), []);
});

test('consecutive lab requirements need configured periods matching the scheduled slot count', () => {
  assert.ok(validateConsecutivePeriods({
    is_consecutive: true, periods_per_session: null, slot_count: 2,
  }).some(issue => issue.rule_code === 'LAB_PERIODS_MISSING'));
  assert.ok(validateConsecutivePeriods({
    is_consecutive: true, periods_per_session: 3, slot_count: 2,
  }).some(issue => issue.rule_code === 'LAB_PERIOD_COUNT_MISMATCH'));
  assert.deepEqual(validateConsecutivePeriods({
    is_consecutive: true, periods_per_session: 2, slot_count: 2,
  }), []);
});

test('missing calendar and verified workload policy prevent configuration readiness', () => {
  const config = validConfig();
  config.calendar_supported = false;
  config.workload_rule_count = 2;
  config.verified_workload_rule_count = 0;
  const issues = validateSchedulingConfiguration(config);
  assert.ok(issues.some(issue => issue.rule_code === 'CALENDAR_UNSUPPORTED'));
  assert.ok(issues.some(issue => issue.rule_code === 'VERIFIED_WORKLOAD_POLICY_MISSING'));
  assert.ok(issues.some(issue => issue.rule_code === 'UNVERIFIED_WORKLOAD_POLICY'));
});
