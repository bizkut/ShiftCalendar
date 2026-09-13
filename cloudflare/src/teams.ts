import type { CloudInvitation, CloudMember, CloudTeam, CloudUser, TeamRole } from '../../shared/cloudTypes';
import { ApiError } from './errors';
import { object } from './calendar';

type TeamRow = { id: string; name: string; timezone: string; owner_sub: string; role: TeamRole; version: number; updated_at: string };
type MemberRow = { user_sub: string; username: string | null; display_name: string; role: TeamRole; joined_at: string; version: number };
type InviteRow = { id: string; team_id: string; team_name: string; invitee_sub: string; invitee_username: string | null; role: Exclude<TeamRole, 'owner'>; status: CloudInvitation['status']; expires_at: string; created_at: string; version: number };
type UserRow = { sub: string; username: string | null; display_name: string; disabled: number; application_admin: number; version: number; updated_at: string };

const identifier = (value: unknown) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new ApiError(400, 'invalid_request', 'Invalid identifier.');
  return value;
};
const text = (value: unknown, label: string, maximum: number) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) throw new ApiError(400, 'invalid_request', `Invalid ${label}.`);
  return value.trim();
};
const role = (value: unknown): Exclude<TeamRole, 'owner'> => {
  if (!['manager', 'member', 'viewer'].includes(String(value))) throw new ApiError(400, 'invalid_request', 'Invalid team role.');
  return value as Exclude<TeamRole, 'owner'>;
};
async function fingerprint(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
}
const team = (row: TeamRow): CloudTeam => ({ id: row.id, name: row.name, timezone: row.timezone, ownerSub: row.owner_sub, role: row.role, version: row.version, updatedAt: row.updated_at });
const member = (row: MemberRow): CloudMember => ({ sub: row.user_sub, displayName: row.display_name || row.username || row.user_sub, role: row.role, joinedAt: row.joined_at, version: row.version });
const invitation = (row: InviteRow): CloudInvitation => ({ id: row.id, teamId: row.team_id, teamName: row.team_name, inviteeSub: row.invitee_sub, inviteeUsername: row.invitee_username || row.invitee_sub, role: row.role, status: row.status, expiresAt: row.expires_at, createdAt: row.created_at, version: row.version });
const user = (row: UserRow): CloudUser => ({ sub: row.sub, username: row.username || '', displayName: row.display_name || row.username || row.sub, disabled: !!row.disabled, applicationAdmin: !!row.application_admin, version: row.version, updatedAt: row.updated_at, accessAdmission: 'external' });

export class TeamRepository {
  constructor(private readonly db: D1Database, private readonly sub: string) {}

  private guard(sql: string, args: (string | number)[]) {
    return this.db.prepare(`INSERT INTO transaction_checks(valid) SELECT CASE WHEN (${sql}) THEN 1 ELSE 0 END`).bind(...args);
  }
  private enabled() { return this.guard('EXISTS (SELECT 1 FROM users WHERE sub = ? AND disabled = 0)', [this.sub]); }
  private admin() { return this.guard(`EXISTS (SELECT 1 FROM users u JOIN application_administrators a ON a.user_sub=u.sub WHERE u.sub=? AND u.disabled=0)`, [this.sub]); }
  private leader(teamId: string) { return this.guard(`EXISTS (SELECT 1 FROM users u JOIN memberships m ON m.user_sub=u.sub JOIN teams t ON t.id=m.team_id WHERE u.sub=? AND u.disabled=0 AND t.id=? AND t.deleted=0 AND m.role='owner')`, [this.sub, teamId]); }
  private async requireAdmin() {
    if (!(await this.session()).applicationAdmin) throw new ApiError(403, 'forbidden', 'Application administrator access is required.');
  }
  private async requireLeader(teamId: string) {
    await this.session();
    const row = await this.db.prepare(`SELECT 1 FROM memberships m JOIN teams t ON t.id=m.team_id
      WHERE m.user_sub=? AND m.team_id=? AND m.role='owner' AND t.deleted=0`).bind(this.sub, teamId).first();
    if (!row) throw new ApiError(403, 'forbidden', 'Team leader access is required.');
  }

  private page(cursor = '', limit = 100) {
    if (cursor) identifier(cursor);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, 'invalid_request', 'Invalid page size.');
    return { cursor, limit };
  }
  private async prior<T>(mutationId: string, operation: string, hash: string) {
    const row = await this.db.prepare(`SELECT m.operation,m.fingerprint,m.result FROM mutations m JOIN users u ON u.sub=m.user_sub WHERE m.user_sub=? AND m.id=? AND u.disabled=0`).bind(this.sub, mutationId).first<{ operation: string; fingerprint: string; result: string }>();
    if (!row) return undefined;
    if (row.operation !== operation || row.fingerprint !== hash) throw new ApiError(409, 'conflict', 'This mutation ID was used for a different operation.');
    return JSON.parse(row.result) as T;
  }
  private record(mutationId: string, operation: string, hash: string, result: unknown, now: string) {
    return [
      this.db.prepare('INSERT INTO mutations(user_sub,id,operation,fingerprint,result) VALUES(?,?,?,?,?)').bind(this.sub, mutationId, operation, hash, JSON.stringify(result)),
      this.db.prepare('INSERT INTO audit(actor_sub,mutation_id,operation,created_at) VALUES(?,?,?,?)').bind(this.sub, mutationId, operation, now),
      this.db.prepare('DELETE FROM transaction_checks'),
    ];
  }
  private async mutation<T>(input: unknown, operation: string, canonical: (value: Record<string, unknown>, body: Record<string, unknown>) => T) {
    const body = object(input); const mutationId = identifier(body.mutationId); const value = object(body.value ?? {});
    const parsed = canonical(value, body); const hash = await fingerprint(parsed);
    return { body, mutationId, parsed, hash, prior: await this.prior<unknown>(mutationId, operation, hash), now: new Date().toISOString() };
  }

  async provision(username: string) {
    const normalized = username.trim().toLowerCase();
    if (!normalized || normalized.length > 254) throw new ApiError(401, 'unauthorized', 'Invalid identity.');
    const existing = await this.db.prepare(`SELECT u.*,EXISTS(SELECT 1 FROM application_administrators a
      WHERE a.user_sub=u.sub) application_admin FROM users u WHERE u.sub=?`).bind(this.sub).first<UserRow>();
    if (existing?.disabled) throw new ApiError(403, 'forbidden', 'This user is disabled.');
    if (existing?.username === normalized) return user(existing);
    const now = new Date().toISOString();
    if (existing) {
      await this.db.prepare(`UPDATE users SET username=?,
        display_name=CASE WHEN display_name='' THEN ? ELSE display_name END,updated_at=? WHERE sub=? AND disabled=0`)
        .bind(normalized, normalized, now, this.sub).run();
    } else {
      await this.db.prepare('INSERT INTO users(sub,username,display_name,updated_at) VALUES(?,?,?,?)')
        .bind(this.sub, normalized, normalized, now).run();
    }
    return this.session();
  }
  async session() {
    const row = await this.db.prepare(`SELECT u.*,EXISTS(SELECT 1 FROM application_administrators a WHERE a.user_sub=u.sub) application_admin FROM users u WHERE u.sub=?`).bind(this.sub).first<UserRow>();
    if (!row || row.disabled) throw new ApiError(403, 'forbidden', 'This user is disabled.');
    return user(row);
  }
  async listUsers(cursor = '', limit = 100) {
    await this.requireAdmin(); const page = this.page(cursor, limit);
    const rows = await this.db.prepare(`SELECT u.*,EXISTS(SELECT 1 FROM application_administrators a WHERE a.user_sub=u.sub) application_admin
      FROM users u WHERE u.sub>? ORDER BY u.sub LIMIT ?`).bind(page.cursor,page.limit+1).all<UserRow>();
    const items=rows.results.slice(0,page.limit).map(user);
    return { items, ...(rows.results.length>page.limit ? {nextCursor:items.at(-1)!.sub}:{}) };
  }
  async listTeams(cursor = '', limit = 100) {
    await this.session(); const page=this.page(cursor,limit);
    const rows = await this.db.prepare(`SELECT t.*,m.role FROM teams t JOIN memberships m ON m.team_id=t.id
      WHERE m.user_sub=? AND t.deleted=0 AND t.id>? ORDER BY t.id LIMIT ?`).bind(this.sub,page.cursor,page.limit+1).all<TeamRow>();
    const items=rows.results.slice(0,page.limit).map(team);
    return {items,...(rows.results.length>page.limit?{nextCursor:items.at(-1)!.id}:{})};
  }
  async listMembers(teamId: string, cursor = '', limit = 100) {
    identifier(teamId); await this.session(); const page=this.page(cursor,limit);
    const access=await this.db.prepare('SELECT 1 FROM memberships WHERE team_id=? AND user_sub=?').bind(teamId,this.sub).first();
    if(!access)throw new ApiError(403,'forbidden','Team access is not allowed.');
    const rows = await this.db.prepare(`SELECT m.user_sub,u.username,u.display_name,m.role,m.joined_at,m.version
      FROM memberships m JOIN users u ON u.sub=m.user_sub WHERE m.team_id=? AND m.user_sub>?
      ORDER BY m.user_sub LIMIT ?`).bind(teamId,page.cursor,page.limit+1).all<MemberRow>();
    const items=rows.results.slice(0,page.limit).map(member);
    return {items,...(rows.results.length>page.limit?{nextCursor:items.at(-1)!.sub}:{})};
  }
  async createTeam(input: unknown) {
    await this.requireAdmin();
    const m = await this.mutation(input, 'create-team', value => ({ name: text(value.name, 'team name', 80), timezone: text(value.timezone, 'timezone', 64) }));
    try { new Intl.DateTimeFormat('en', { timeZone: m.parsed.timezone }); } catch { throw new ApiError(400, 'invalid_request', 'Invalid timezone.'); }
    if (m.prior) return m.prior as CloudTeam;
    const result: CloudTeam = { id: crypto.randomUUID(), ...m.parsed, ownerSub: this.sub, role: 'owner', version: 1, updatedAt: m.now };
    try { await this.db.batch([this.admin(), this.db.prepare('INSERT INTO teams(id,owner_sub,name,timezone,updated_at) VALUES(?,?,?,?,?)').bind(result.id,this.sub,result.name,result.timezone,m.now), this.db.prepare(`INSERT INTO memberships(team_id,user_sub,role,joined_at) VALUES(?,?,'owner',?)`).bind(result.id,this.sub,m.now), ...this.record(m.mutationId,'create-team',m.hash,result,m.now)]); }
    catch { const prior=await this.prior<CloudTeam>(m.mutationId,'create-team',m.hash); if (prior) return prior; throw new ApiError(409,'conflict','Team creation conflicted.'); }
    return result;
  }
  async listInvitations(teamId?: string, cursor = '', limit = 100) {
    await this.session(); const page=this.page(cursor,limit);
    if (teamId) await this.requireLeader(identifier(teamId));
    const base = `SELECT i.*,t.name team_name,u.username invitee_username FROM team_invitations i
      JOIN teams t ON t.id=i.team_id JOIN users u ON u.sub=i.invitee_sub`;
    const rows = teamId
      ? await this.db.prepare(`${base} WHERE i.team_id=? AND i.id>? ORDER BY i.id LIMIT ?`).bind(teamId,page.cursor,page.limit+1).all<InviteRow>()
      : await this.db.prepare(`${base} WHERE i.invitee_sub=? AND i.id>? ORDER BY i.id LIMIT ?`).bind(this.sub,page.cursor,page.limit+1).all<InviteRow>();
    const items=rows.results.slice(0,page.limit).map(invitation);
    return {items,...(rows.results.length>page.limit?{nextCursor:items.at(-1)!.id}:{})};
  }
  async createInvitation(teamId: string, input: unknown) {
    identifier(teamId);
    await this.requireLeader(teamId);
    const m = await this.mutation(input,'create-invitation',value=>({ teamId, inviteeUsername:text(value.inviteeUsername,'invitee email',254).toLowerCase(), role:role(value.role), expiresAt:text(value.expiresAt,'expiry',64) }));
    if (!Number.isFinite(Date.parse(m.parsed.expiresAt)) || Date.parse(m.parsed.expiresAt) <= Date.now()) throw new ApiError(400,'invalid_request','Invitation expiry must be in the future.');
    if (m.prior) return m.prior as CloudInvitation;
    const invitee = await this.db.prepare('SELECT sub FROM users WHERE username=? AND disabled=0').bind(m.parsed.inviteeUsername).first<{sub:string}>();
    if (!invitee) throw new ApiError(404,'not_found','That user must sign in through Cloudflare Access before being invited.');
    const result: CloudInvitation={id:crypto.randomUUID(),teamId,teamName:'',inviteeSub:invitee.sub,inviteeUsername:m.parsed.inviteeUsername,role:m.parsed.role,status:'pending',expiresAt:m.parsed.expiresAt,createdAt:m.now,version:1};
    try { await this.db.batch([this.leader(teamId),this.guard('NOT EXISTS(SELECT 1 FROM memberships WHERE team_id=? AND user_sub=?)',[teamId,invitee.sub]),this.db.prepare(`INSERT INTO team_invitations(id,team_id,invitee_sub,role,status,expires_at,created_by,created_at) VALUES(?,?,?,?,'pending',?,?,?)`).bind(result.id,teamId,invitee.sub,result.role,result.expiresAt,this.sub,m.now),...this.record(m.mutationId,'create-invitation',m.hash,result,m.now)]); }
    catch { const prior=await this.prior<CloudInvitation>(m.mutationId,'create-invitation',m.hash); if(prior)return prior; throw new ApiError(409,'conflict','Invitation creation conflicted.'); }
    return result;
  }
  async respondInvitation(invitationId: string, input: unknown) {
    identifier(invitationId);
    const m=await this.mutation(input,'respond-invitation',value=>{if(!['accepted','declined'].includes(String(value.status)))throw new ApiError(400,'invalid_request','Invalid invitation response.');return {invitationId,status:value.status as 'accepted'|'declined'};});
    if(m.prior)return m.prior as CloudInvitation;
    const row=await this.db.prepare(`SELECT i.*,t.name team_name,u.username invitee_username FROM team_invitations i JOIN teams t ON t.id=i.team_id JOIN users u ON u.sub=i.invitee_sub WHERE i.id=? AND i.invitee_sub=?`).bind(invitationId,this.sub).first<InviteRow>();
    if(!row)throw new ApiError(404,'not_found','Invitation was not found.');
    const result={...invitation(row),status:m.parsed.status,version:row.version+1};
    const statements=[this.enabled(),this.guard(`EXISTS(SELECT 1 FROM team_invitations WHERE id=? AND invitee_sub=? AND status='pending' AND expires_at>? AND version=?)`,[invitationId,this.sub,m.now,row.version]),this.db.prepare(`UPDATE team_invitations SET status=?,responded_at=?,version=version+1 WHERE id=?`).bind(m.parsed.status,m.now,invitationId)];
    if(m.parsed.status==='accepted')statements.push(this.db.prepare(`INSERT INTO memberships(team_id,user_sub,role,joined_at) VALUES(?,?,?,?)`).bind(row.team_id,this.sub,row.role,m.now));
    try{await this.db.batch([...statements,...this.record(m.mutationId,'respond-invitation',m.hash,result,m.now)]);}catch{const prior=await this.prior<CloudInvitation>(m.mutationId,'respond-invitation',m.hash);if(prior)return prior;throw new ApiError(409,'conflict','Invitation is no longer available.');}
    return result;
  }
  async revokeInvitation(teamId: string, invitationId: string, input: unknown) {
    identifier(teamId); identifier(invitationId); await this.requireLeader(teamId);
    const body = object(input); const mutationId = identifier(body.mutationId);
    const canonical = { teamId, invitationId }; const hash = await fingerprint(canonical);
    const prior = await this.prior<CloudInvitation>(mutationId, 'revoke-invitation', hash);
    if (prior) return prior;
    const row = await this.db.prepare(`SELECT i.*,t.name team_name,u.username invitee_username
      FROM team_invitations i JOIN teams t ON t.id=i.team_id JOIN users u ON u.sub=i.invitee_sub
      WHERE i.id=? AND i.team_id=?`).bind(invitationId, teamId).first<InviteRow>();
    if (!row) throw new ApiError(404, 'not_found', 'Invitation was not found.');
    if (row.status !== 'pending') throw new ApiError(409, 'conflict', 'Invitation is no longer pending.');
    const now = new Date().toISOString(); const result = { ...invitation(row), status: 'revoked' as const, version: row.version + 1 };
    try {
      await this.db.batch([this.leader(teamId), this.guard(`EXISTS(SELECT 1 FROM team_invitations WHERE id=? AND team_id=? AND status='pending' AND version=?)`, [invitationId,teamId,row.version]),
        this.db.prepare(`UPDATE team_invitations SET status='revoked',responded_at=?,version=version+1 WHERE id=?`).bind(now,invitationId),
        ...this.record(mutationId,'revoke-invitation',hash,result,now)]);
    } catch {
      const retried=await this.prior<CloudInvitation>(mutationId,'revoke-invitation',hash); if(retried)return retried;
      throw new ApiError(409,'conflict','Invitation changed. Refresh and retry.');
    }
    return result;
  }
  async changeMember(teamId:string,memberSub:string,input:unknown){
    identifier(teamId);identifier(memberSub);
    await this.requireLeader(teamId);
    const m=await this.mutation(input,'change-member-role',value=>({teamId,memberSub,role:role(value.role)})); if(m.prior)return m.prior as CloudMember;
    const current=await this.db.prepare(`SELECT m.user_sub,u.username,u.display_name,m.role,m.joined_at,m.version FROM memberships m JOIN users u ON u.sub=m.user_sub WHERE m.team_id=? AND m.user_sub=?`).bind(teamId,memberSub).first<MemberRow>();
    if(!current||current.role==='owner')throw new ApiError(409,'conflict','The team leader role must be transferred.');
    const result={...member(current),role:m.parsed.role,version:current.version+1};
    try{await this.db.batch([this.leader(teamId),this.guard('EXISTS(SELECT 1 FROM memberships WHERE team_id=? AND user_sub=? AND role<>\'owner\' AND version=?)',[teamId,memberSub,current.version]),this.db.prepare('UPDATE memberships SET role=?,version=version+1 WHERE team_id=? AND user_sub=?').bind(m.parsed.role,teamId,memberSub),...this.record(m.mutationId,'change-member-role',m.hash,result,m.now)]);}catch{const prior=await this.prior<CloudMember>(m.mutationId,'change-member-role',m.hash);if(prior)return prior;throw new ApiError(409,'conflict','Membership changed. Refresh and retry.');} return result;
  }
  async removeMember(teamId:string,memberSub:string,input:unknown){
    identifier(teamId);identifier(memberSub);if(memberSub===this.sub)await this.session();else await this.requireLeader(teamId);const body=object(input);const mutationId=identifier(body.mutationId);const canonical={teamId,memberSub};const hash=await fingerprint(canonical);const prior=await this.prior<CloudMember>(mutationId,'remove-member',hash);if(prior)return prior;
    const current=await this.db.prepare(`SELECT m.user_sub,u.username,u.display_name,m.role,m.joined_at,m.version FROM memberships m JOIN users u ON u.sub=m.user_sub WHERE m.team_id=? AND m.user_sub=?`).bind(teamId,memberSub).first<MemberRow>();if(!current||current.role==='owner')throw new ApiError(409,'conflict','The team leader cannot be removed.');const result=member(current);const now=new Date().toISOString();
    const authority=memberSub===this.sub?this.enabled():this.leader(teamId);try{await this.db.batch([authority,this.guard('EXISTS(SELECT 1 FROM memberships WHERE team_id=? AND user_sub=? AND role<>\'owner\' AND version=?)',[teamId,memberSub,current.version]),this.db.prepare('DELETE FROM memberships WHERE team_id=? AND user_sub=?').bind(teamId,memberSub),...this.record(mutationId,'remove-member',hash,result,now)]);}catch{const retried=await this.prior<CloudMember>(mutationId,'remove-member',hash);if(retried)return retried;throw new ApiError(409,'conflict','Membership changed. Refresh and retry.');}return result;
  }
  async transfer(teamId:string,input:unknown){identifier(teamId);await this.requireLeader(teamId);const m=await this.mutation(input,'transfer-team-leader',(value,body)=>({teamId,newOwnerSub:identifier(value.newOwnerSub),expectedVersion:Number(body.expectedVersion)}));if(!Number.isInteger(m.parsed.expectedVersion)||m.parsed.expectedVersion<1)throw new ApiError(400,'invalid_request','Invalid team version.');if(m.prior)return m.prior as CloudTeam;const target=await this.db.prepare('SELECT role FROM memberships WHERE team_id=? AND user_sub=?').bind(teamId,m.parsed.newOwnerSub).first<{role:TeamRole}>();if(!target)throw new ApiError(404,'not_found','Member was not found.');const current=await this.db.prepare('SELECT t.*,m.role FROM teams t JOIN memberships m ON m.team_id=t.id AND m.user_sub=? WHERE t.id=?').bind(this.sub,teamId).first<TeamRow>();if(!current)throw new ApiError(403,'forbidden','Team access is not allowed.');const result={...team(current),ownerSub:m.parsed.newOwnerSub,role:'manager' as TeamRole,version:current.version+1,updatedAt:m.now};try{await this.db.batch([this.leader(teamId),this.guard('EXISTS(SELECT 1 FROM teams WHERE id=? AND version=? AND deleted=0)',[teamId,m.parsed.expectedVersion]),this.db.prepare(`UPDATE memberships SET role='manager',version=version+1 WHERE team_id=? AND user_sub=?`).bind(teamId,this.sub),this.db.prepare(`UPDATE memberships SET role='owner',version=version+1 WHERE team_id=? AND user_sub=?`).bind(teamId,m.parsed.newOwnerSub),this.db.prepare('UPDATE teams SET owner_sub=?,version=version+1,updated_at=? WHERE id=?').bind(m.parsed.newOwnerSub,m.now,teamId),...this.record(m.mutationId,'transfer-team-leader',m.hash,result,m.now)]);}catch{const prior=await this.prior<CloudTeam>(m.mutationId,'transfer-team-leader',m.hash);if(prior)return prior;throw new ApiError(409,'conflict','Team changed. Refresh and retry.');}return result;}
  async updateUser(targetSub:string,input:unknown){identifier(targetSub);await this.requireAdmin();const m=await this.mutation(input,'update-user',(value,body)=>{if(typeof value.disabled!=='boolean'||typeof value.applicationAdmin!=='boolean')throw new ApiError(400,'invalid_request','Invalid user status.');return{targetSub,disabled:value.disabled,applicationAdmin:value.applicationAdmin,expectedVersion:Number(body.expectedVersion)};});if(!Number.isInteger(m.parsed.expectedVersion)||m.parsed.expectedVersion<1)throw new ApiError(400,'invalid_request','Invalid user version.');if(m.prior)return m.prior as CloudUser;const current=await this.db.prepare(`SELECT u.*,EXISTS(SELECT 1 FROM application_administrators a WHERE a.user_sub=u.sub) application_admin FROM users u WHERE u.sub=?`).bind(targetSub).first<UserRow>();if(!current)throw new ApiError(404,'not_found','User was not found.');if(targetSub===this.sub&&(m.parsed.disabled||!m.parsed.applicationAdmin))throw new ApiError(409,'conflict','Transfer administration before changing your own access.');const result:userReturn={...user(current),disabled:m.parsed.disabled,applicationAdmin:m.parsed.applicationAdmin,version:current.version+1,updatedAt:m.now};const statements=[this.admin(),this.guard('EXISTS(SELECT 1 FROM users WHERE sub=? AND version=?)',[targetSub,m.parsed.expectedVersion])];if(current.application_admin&&(m.parsed.disabled||!m.parsed.applicationAdmin))statements.push(this.guard(`(SELECT COUNT(*) FROM application_administrators a JOIN users u ON u.sub=a.user_sub WHERE u.disabled=0 AND a.user_sub<>?)>0`,[targetSub]));statements.push(this.db.prepare('UPDATE users SET disabled=?,version=version+1,updated_at=? WHERE sub=?').bind(m.parsed.disabled?1:0,m.now,targetSub));statements.push(m.parsed.applicationAdmin?this.db.prepare('INSERT INTO application_administrators(user_sub,created_at) VALUES(?,?) ON CONFLICT(user_sub) DO NOTHING').bind(targetSub,m.now):this.db.prepare('DELETE FROM application_administrators WHERE user_sub=?').bind(targetSub));try{await this.db.batch([...statements,...this.record(m.mutationId,'update-user',m.hash,result,m.now)]);}catch{const prior=await this.prior<CloudUser>(m.mutationId,'update-user',m.hash);if(prior)return prior;throw new ApiError(409,'conflict','User status changed. Refresh and retry.');}return result;}
}

type userReturn = CloudUser;
