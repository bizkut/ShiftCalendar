-- Expired invitations remain as immutable history but must not block a new invitation.
-- Current pending uniqueness is enforced by the mutation-boundary transaction guard.
DROP INDEX team_invitations_pending;
CREATE INDEX team_invitations_pending_lookup
  ON team_invitations(team_id, invitee_sub, status, expires_at);
