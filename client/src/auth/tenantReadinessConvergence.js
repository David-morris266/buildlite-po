export async function convergeTenantReadinessAfterMutation(principal, { refreshAuthority } = {}) {
  principal?.markTenantReadinessStale?.();

  let authorityResult;
  let authorityError = null;
  try {
    authorityResult = await refreshAuthority?.();
  } catch (error) {
    authorityError = error;
  }

  let readinessError = null;
  try {
    if (!principal?.refreshTenantReadiness) {
      throw new Error('Company Readiness refresh is unavailable.');
    }
    await principal.refreshTenantReadiness();
  } catch (error) {
    readinessError = error;
    principal?.markTenantReadinessStale?.();
  }

  return {
    authorityResult,
    authorityError,
    readinessRefreshed: readinessError == null,
    readinessError,
  };
}

export function costCodeMutationAffectsTenantReadiness({ isNew = false, previous, next } = {}) {
  if (isNew) return true;
  if (previous?.active !== next?.active) return true;
  return ['commercialHeadId', 'commercialFamilyId', 'reportingGroupId', 'hierarchyReviewDisposition']
    .some((key) => (previous?.[key] || null) !== (next?.[key] || null));
}
