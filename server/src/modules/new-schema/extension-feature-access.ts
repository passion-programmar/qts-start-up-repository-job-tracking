import { Response } from 'express';
import { queryOne } from '../../database/connection';
import { NewSchemaAuthRequest } from '../../middleware/new-schema-auth';

export type ManagerExtensionFeature = 'text_highlights_manage' | 'job_site_scanner';

export async function managerHasExtensionFeature(
  managerId: number,
  feature: ManagerExtensionFeature
): Promise<boolean> {
  const assignment = await queryOne<{ manager_user_id: number }>(
    `SELECT manager_user_id
     FROM manager_extension_feature_assignments
     WHERE manager_user_id = $1 AND feature_key = $2`,
    [managerId, feature]
  );
  return Boolean(assignment);
}

export async function requireManagerExtensionFeature(
  req: NewSchemaAuthRequest,
  res: Response,
  feature: ManagerExtensionFeature
): Promise<boolean> {
  const user = req.newSchemaUser;
  if (user?.role !== 'manager' || !(await managerHasExtensionFeature(user.id, feature))) {
    const featureLabel = feature === 'job_site_scanner' ? 'Scanner' : 'text highlight management';
    res.status(403).json({
      success: false,
      code: 'EXTENSION_FEATURE_NOT_ASSIGNED',
      message: `Your Super administrator has not assigned ${featureLabel} access to your Manager account.`,
    });
    return false;
  }
  return true;
}
