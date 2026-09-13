export type TeamRole = 'owner' | 'manager' | 'member' | 'viewer';
export type CalendarScope = 'private' | 'team';

export interface CloudProfile {
  sub: string;
  displayName: string;
  timezone: string;
  version: number;
  updatedAt: string;
}

export interface CloudTeam {
  id: string;
  name: string;
  timezone: string;
  ownerSub: string;
  role: TeamRole;
  version: number;
  updatedAt: string;
}

export interface CloudMember {
  sub: string;
  displayName: string;
  role: TeamRole;
  joinedAt: string;
  version: number;
}

export interface CloudUser {
  sub: string;
  username: string;
  displayName: string;
  disabled: boolean;
  applicationAdmin: boolean;
  version: number;
  updatedAt: string;
  accessAdmission: 'external';
}

export interface CloudInvitation {
  id: string;
  teamId: string;
  teamName: string;
  inviteeSub: string;
  inviteeUsername: string;
  role: Exclude<TeamRole, 'owner'>;
  status: 'pending' | 'accepted' | 'declined' | 'revoked';
  expiresAt: string;
  createdAt: string;
  version: number;
}

/** Legacy AWS invitation-link response. Cloudflare uses targeted CloudInvitation records. */
export interface InvitationCreated {
  id: string;
  teamId: string;
  role: Exclude<TeamRole, 'owner'>;
  expiresAt: string;
  token: string;
}

export interface CloudCalendar {
  id: string;
  name: string;
  color: string;
  timezone: string;
  scope: CalendarScope;
  teamId?: string;
  assignedMemberSub?: string;
  role?: TeamRole;
  version: number;
  updatedAt: string;
}

export interface CloudCalendarDay {
  date: string;
  shiftCode?: string;
  availability?: string;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

export interface CloudCalendarDayTombstone {
  date: string;
  deleted: true;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

export interface CloudPrivateDayDetails {
  date: string;
  note?: string;
  overtimeHours?: number;
  leaveTypeId?: string;
  leaveReason?: string;
  version: number;
  updatedAt: string;
}

export interface CloudPrivateDetails {
  calendarId: string;
  payRate?: number;
  leaveBalances: Record<string, number>;
  days: CloudPrivateDayDetails[];
  version: number;
  updatedAt: string;
}

export interface CloudShiftType {
  code: string;
  label: string;
  color: string;
  startTime: string;
  endTime: string;
  icon: string;
  isDefault: boolean;
  version: number;
  updatedAt: string;
}

export interface TeamRosterDay extends CloudCalendarDay {
  calendarId: string;
  memberSub: string;
  memberDisplayName: string;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface MutationRequest<T> {
  mutationId: string;
  expectedVersion: number;
  value: T;
}

export interface CreateRequest<T> {
  mutationId: string;
  value: T;
}

export interface BulkDayMutation {
  date: string;
  expectedVersion: number;
  value: Pick<CloudCalendarDay, 'shiftCode' | 'availability'> | null;
}

export interface BulkDayRequest {
  mutationId: string;
  edits: BulkDayMutation[];
}

export interface ApiError {
  code: 'bad_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'rate_limited' | 'internal';
  message: string;
  details?: unknown;
}

export interface ApiResponse<T> {
  data?: T;
  error?: ApiError;
}
