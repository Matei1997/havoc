# Plan: Admin/Report Subsystem Security Audit

## Context
Read-only audit of admin, moderation, report, and trust systems for arena-server-backup-master.
No code modifications. Output: `AUDIT_ADMIN_REPORTS.md` in the worktree root.

## Files Audited
- `ragemp-server/.env` — credentials file
- `ragemp-server/conf.json` — server config
- `source/server/commands/Admin.commands.ts` (867 lines)
- `source/server/serverevents/Admin.event.ts` (1023 lines)
- `source/server/serverevents/Report.event.ts` (278 lines)
- `source/server/report/Report.manager.ts` (194 lines)
- `source/server/admin/AdminAudit.service.ts` (63 lines)
- `source/server/admin/AdminAntiCheat.service.ts` (210 lines)
- `source/server/admin/AdminPovCapture.service.ts` (359 lines)
- `source/server/admin/AdminLog.manager.ts` (172 lines)
- `source/server/admin/AdminChat.service.ts`
- `source/client/modules/Noclip.module.ts`
- `source/client/modules/AdminESP.module.ts`
- `source/client/modules/AdminGodmode.module.ts`
- `source/client/modules/AdminPovCapture.module.ts`
- `source/client/classes/Spectate.class.ts`

## Key Findings Summary

### CRITICAL
1. `.env` committed to git with plaintext DB password and Discord OAuth secret
2. Audit log (AdminAudit) is in-memory only — lost on every restart
3. Report system is entirely in-memory — all reports lost on restart

### HIGH
4. POV frame chunks have no per-chunk size cap — memory/disk exhaustion
5. Zone editor destructive ops (deleteMap, deleteZone) have no audit log entries
6. Anti-cheat flag history deleted on playerQuit — cheaters can reset by reconnecting
7. CEF debugging enabled in conf.json (`allow-cef-debugging: true`)

### MEDIUM
8. No time-based cooldown on report creation (count-based only)
9. Heartbeat nonce uses Math.random() (not cryptographically secure)
10. reportedPlayerId/Name not validated against actual players
11. Report message length unbounded
12. Admin panel open not logged; admin duty toggle not logged

### TRUST BOUNDARY
13. Noclip hasAccess() reads server-set player variable — safe by RAGE:MP design
14. ESP reads server-set adminLevel variable — safe
15. Admin-SetGM client event can be self-invoked (GTA native setInvincible)
16. Admin spectate state passed to CEF with no schema validation

### RAGE:MP Unverified
17. Player variable server-authority guarantee not verified against live docs
18. getAdminLevel() is a custom extension — behavior unverified
19. CEF page isolation model unverified

## Implementation Plan
Single action: write `AUDIT_ADMIN_REPORTS.md` to the worktree root with full structured findings.
