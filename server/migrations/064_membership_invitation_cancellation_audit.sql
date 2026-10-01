-- Willow Blocker 25: truthful immutable audit vocabulary for invitation cancellation.
-- No existing audit, invitation, membership, capability or commercial row is changed.

ALTER TABLE tenant_membership_authority_audit
  DROP CONSTRAINT tenant_membership_authority_audit_operation_check;

ALTER TABLE tenant_membership_authority_audit
  ADD CONSTRAINT tenant_membership_authority_audit_operation_check
  CHECK(operation IN(
    'bootstrap_admin_established',
    'invitation_created',
    'invitation_accepted',
    'invitation_cancelled',
    'membership_activated',
    'primary_role_changed',
    'capability_granted',
    'capability_revoked',
    'membership_deactivated',
    'membership_reactivated'
  ));
