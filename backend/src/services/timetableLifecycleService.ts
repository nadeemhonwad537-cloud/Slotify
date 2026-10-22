import { PoolConnection } from 'mysql2/promise';
import { withTransaction } from '../db/pool';
import { audit } from './audit';
import { runValidationAndPersist, PersistedValidationRun } from './validationService';
import { authorizedTimetableActorRole, canApproveTimetable, canPublishTimetable, canSubmitTimetableForReview } from './timetableLifecycleRules';
import { HttpError } from '../utils/errors';

type LifecycleResult = {
  version_id: number;
  status: string;
  validation: PersistedValidationRun;
};

async function lockTimetableContext(conn: PoolConnection, versionId: number) {
  const [[initial]]: any = await conn.query(
    'SELECT term_id FROM timetable_versions WHERE version_id = ?',
    [versionId],
  );
  if (!initial) throw new HttpError(404, 'Timetable version not found', 'NOT_FOUND');

  const [[term]]: any = await conn.query(
    'SELECT term_id FROM terms WHERE term_id = ? FOR UPDATE',
    [initial.term_id],
  );
  if (!term) throw new HttpError(409, 'The timetable academic term is no longer available', 'TERM_CONTEXT_MISSING');

  const [[version]]: any = await conn.query(
    'SELECT version_id, term_id, status, availability_unknown_status FROM timetable_versions WHERE version_id = ? FOR UPDATE',
    [versionId],
  );
  if (!version || Number(version.term_id) !== Number(term.term_id)) {
    throw new HttpError(409, 'The timetable version academic context changed; reload and retry', 'VERSION_CONTEXT_CHANGED');
  }
  return version;
}

async function authorizedActorRole(conn: PoolConnection, roles: string[], permissions: string | string[]): Promise<string> {
  const [rows]: any = await conn.query(
    'SELECT role FROM role_permissions WHERE permission IN (?)',
    [Array.isArray(permissions) ? permissions : [permissions]],
  );
  const role = authorizedTimetableActorRole(roles, rows.map((row: any) => row.role));
  if (!role) throw new HttpError(403, 'You do not have permission to perform this timetable action', 'FORBIDDEN');
  return role;
}

function requireKnownAvailability(version: any) {
  if (version.availability_unknown_status === 'OPEN') {
    throw new HttpError(
      422,
      'Unknown faculty availability must be resolved or explicitly overridden before review or publication.',
      'UNKNOWN_AVAILABILITY_OPEN',
    );
  }
}

export async function submitTimetableForReview(
  versionId: number,
  actorUserId: number,
  actorRoles: string[],
): Promise<LifecycleResult> {
  return withTransaction(async conn => {
    const version = await lockTimetableContext(conn, versionId);
    if (version.status !== 'DRAFT' && version.status !== 'VALIDATED') {
      throw new HttpError(409, 'Only a draft or validated timetable can be submitted for review', 'INVALID_REVIEW_TRANSITION');
    }
    requireKnownAvailability(version);

    const validation = await runValidationAndPersist(versionId, actorUserId, conn);
    if (!canSubmitTimetableForReview({
      status: validation.status === 'PASSED' ? 'VALIDATED' : version.status,
      validationStatus: validation.status,
      errorCount: validation.error_count,
      sessionCount: validation.session_count,
      availabilityUnknownStatus: version.availability_unknown_status,
    })) {
      const [[current]]: any = await conn.query(
        'SELECT status FROM timetable_versions WHERE version_id = ?',
        [versionId],
      );
      return { version_id: versionId, status: current?.status ?? version.status, validation };
    }

    const role = await authorizedActorRole(conn, actorRoles, 'timetable:review');
    const [updated]: any = await conn.query(
      "UPDATE timetable_versions SET status = 'IN_REVIEW' WHERE version_id = ? AND status = 'VALIDATED'",
      [versionId],
    );
    if (updated.affectedRows !== 1) {
      throw new HttpError(409, 'The timetable changed during review submission; reload and retry', 'VERSION_STATUS_CONFLICT');
    }
    await conn.query(
      `INSERT INTO approval_actions (version_id, action_type, actor_id, actor_role, comment)
       VALUES (?, 'SUBMIT_FOR_REVIEW', ?, ?, NULL)`,
      [versionId, actorUserId, role],
    );
    await audit(conn, actorUserId, 'TIMETABLE_SUBMITTED_FOR_REVIEW', 'timetable_versions', versionId, {
      validation_id: validation.validation_id,
      term_id: version.term_id,
    });
    return { version_id: versionId, status: 'IN_REVIEW', validation };
  });
}

export async function requestTimetableChanges(
  versionId: number,
  actorUserId: number,
  actorRoles: string[],
  comment: string,
): Promise<{ version_id: number; status: 'DRAFT' }> {
  return withTransaction(async conn => {
    const version = await lockTimetableContext(conn, versionId);
    if (version.status !== 'IN_REVIEW' && version.status !== 'APPROVED') {
      throw new HttpError(409, 'Only a timetable awaiting review can be returned for changes', 'INVALID_REVIEW_TRANSITION');
    }
    const role = await authorizedActorRole(conn, actorRoles, 'timetable:review');
    const [updated]: any = await conn.query(
      "UPDATE timetable_versions SET status = 'DRAFT' WHERE version_id = ? AND status = 'IN_REVIEW'",
      [versionId],
    );
    if (updated.affectedRows !== 1) {
      throw new HttpError(409, 'The timetable changed during review; reload and retry', 'VERSION_STATUS_CONFLICT');
    }
    await conn.query(
      `INSERT INTO approval_actions (version_id, action_type, actor_id, actor_role, comment)
       VALUES (?, 'REQUEST_CHANGES', ?, ?, ?)`,
      [versionId, actorUserId, role, comment],
    );
    await audit(conn, actorUserId, 'TIMETABLE_CHANGES_REQUESTED', 'timetable_versions', versionId, {
      term_id: version.term_id,
      comment,
    });
    return { version_id: versionId, status: 'DRAFT' };
  });
}

export async function approveTimetable(
  versionId: number,
  actorUserId: number,
  actorRoles: string[],
): Promise<LifecycleResult> {
  return withTransaction(async conn => {
    const version = await lockTimetableContext(conn, versionId);
    if (version.status !== 'IN_REVIEW') {
      throw new HttpError(409, 'Only a timetable submitted for review can be approved', 'INVALID_APPROVAL_TRANSITION');
    }
    requireKnownAvailability(version);

    const validation = await runValidationAndPersist(versionId, actorUserId, conn);
    if (!canApproveTimetable({
      status: version.status,
      validationStatus: validation.status,
      errorCount: validation.error_count,
      sessionCount: validation.session_count,
      availabilityUnknownStatus: version.availability_unknown_status,
    })) {
      return { version_id: versionId, status: version.status, validation };
    }

    const role = await authorizedActorRole(conn, actorRoles, ['timetable:approve', 'timetable:publish']);
    const [updated]: any = await conn.query(
      "UPDATE timetable_versions SET status = 'APPROVED' WHERE version_id = ? AND status = 'IN_REVIEW'",
      [versionId],
    );
    if (updated.affectedRows !== 1) {
      throw new HttpError(409, 'The timetable changed during approval; reload and retry', 'VERSION_STATUS_CONFLICT');
    }
    await conn.query(
      `INSERT INTO approval_actions (version_id, action_type, actor_id, actor_role, comment)
       VALUES (?, 'APPROVE', ?, ?, NULL)`,
      [versionId, actorUserId, role],
    );
    await audit(conn, actorUserId, 'TIMETABLE_VERSION_APPROVED', 'timetable_versions', versionId, {
      validation_id: validation.validation_id,
      term_id: version.term_id,
    });
    return { version_id: versionId, status: 'APPROVED', validation };
  });
}

export async function publishTimetable(
  versionId: number,
  actorUserId: number,
  actorRoles: string[],
): Promise<LifecycleResult> {
  return withTransaction(async conn => {
    const version = await lockTimetableContext(conn, versionId);
    if (version.status !== 'APPROVED') {
      throw new HttpError(409, 'Only an approved timetable can be published', 'INVALID_PUBLISH_TRANSITION');
    }
    requireKnownAvailability(version);

    const validation = await runValidationAndPersist(versionId, actorUserId, conn);
    const canPublish = canPublishTimetable({
      status: version.status,
      validationStatus: validation.status,
      errorCount: validation.error_count,
      sessionCount: validation.session_count,
      availabilityUnknownStatus: version.availability_unknown_status,
    });
    if (!canPublish) return { version_id: versionId, status: version.status, validation };

    const role = await authorizedActorRole(conn, actorRoles, 'timetable:publish');
    const [currentPublished]: any = await conn.query(
      "SELECT version_id FROM timetable_versions WHERE term_id = ? AND status = 'PUBLISHED' FOR UPDATE",
      [version.term_id],
    );
    if (currentPublished.length) {
      await conn.query(
        "UPDATE timetable_versions SET status = 'ARCHIVED' WHERE version_id = ? AND status = 'PUBLISHED'",
        [currentPublished[0].version_id],
      );
      await audit(conn, actorUserId, 'TIMETABLE_VERSION_ARCHIVED', 'timetable_versions', currentPublished[0].version_id, {
        replacement_version_id: versionId,
        term_id: version.term_id,
      });
    }

    const [published]: any = await conn.query(
      "UPDATE timetable_versions SET status = 'PUBLISHED', published_at = UTC_TIMESTAMP() WHERE version_id = ? AND status = 'APPROVED'",
      [versionId],
    );
    if (published.affectedRows !== 1) {
      throw new HttpError(409, 'The timetable changed during publication; no version was published', 'VERSION_STATUS_CONFLICT');
    }
    await conn.query(
      `INSERT INTO approval_actions (version_id, action_type, actor_id, actor_role, comment)
       VALUES (?, 'PUBLISH', ?, ?, NULL)`,
      [versionId, actorUserId, role],
    );
    await audit(conn, actorUserId, 'TIMETABLE_VERSION_PUBLISHED', 'timetable_versions', versionId, {
      validation_id: validation.validation_id,
      term_id: version.term_id,
      archived_version_id: currentPublished[0]?.version_id ?? null,
    });
    return { version_id: versionId, status: 'PUBLISHED', validation };
  });
}
