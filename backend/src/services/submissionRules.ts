import { HttpError } from '../utils/errors';
import { availabilityType } from '../utils/zodHelpers';
import { MAX_PREFERENCES } from './preferenceValidation';

export interface AvailabilityWindowInput {
  day: string;
  start_time: string;
  end_time: string;
  availability_type: typeof availabilityType._type;
}

export function assertRequiredPreferenceCount(count: number) {
  if (count !== MAX_PREFERENCES) {
    throw new HttpError(
      400,
      `Exactly ${MAX_PREFERENCES} subject preferences are required before submitting (you have ${count})`,
      'WRONG_PREFERENCE_COUNT',
    );
  }
}

export function validateAvailabilityWindows(windows: readonly AvailabilityWindowInput[]) {
  for (const window of windows) {
    if (window.end_time <= window.start_time) {
      throw new HttpError(422, 'end_time must be after start_time', 'TIME_ORDER');
    }
  }

  for (let i = 0; i < windows.length; i++) {
    for (let j = i + 1; j < windows.length; j++) {
      const first = windows[i];
      const second = windows[j];
      if (first.day === second.day && first.start_time < second.end_time && second.start_time < first.end_time) {
        throw new HttpError(422, 'Availability windows in the form overlap each other', 'AVAILABILITY_OVERLAP');
      }
    }
  }
}

export function assertReviewActionAllowed(
  submissionStatus: string,
  reviewStatus: string,
  action: 'START_REVIEW' | 'ACCEPT' | 'RETURN',
) {
  if (submissionStatus !== 'SUBMITTED') {
    throw new HttpError(409, `Only submitted forms can be reviewed (current status: ${submissionStatus})`, 'INVALID_STATE');
  }
  if (action === 'START_REVIEW' && reviewStatus !== 'PENDING') {
    throw new HttpError(409, `Review already ${reviewStatus}`, 'INVALID_STATE');
  }
  if (action === 'ACCEPT' && reviewStatus === 'ACCEPTED') {
    throw new HttpError(409, 'Already accepted', 'INVALID_STATE');
  }
  if (action === 'RETURN' && reviewStatus === 'ACCEPTED') {
    throw new HttpError(409, 'An accepted submission cannot be returned', 'INVALID_STATE');
  }
}
