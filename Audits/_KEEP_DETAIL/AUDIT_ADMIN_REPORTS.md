# AUDIT_ADMIN_REPORTS.md
## Admin / Moderation / Report / Trust Systems — Security Audit
**Date:** 2026-04-24  
**Scope:** Server-side admin commands, admin CEF events, report manager, anti-cheat, POV capture, audit logging, client-side admin modules, ragemp-server configuration.  
**Method:** Static source analysis. No live server, no RAGE:MP binary inspection.

---

## Files Reviewed

| File | Lines | Role |
|------|-------|------|
| `ragemp-server/.env` | 8 | Runtime secrets |
| `ragemp-server/conf.json` | 12 | Server config |
| `source/server/commands/Admin.commands.ts` | 867 | All admin chat commands |
| `source/server/serverevents/Admin.event.ts` | 1023 | Admin CEF event handlers, zone editor |
| `source/server/serverevents/Report.event.ts` | 278 | Report CEF event handlers |
| `source/server/report/Report.manager.ts` | 194 | Report state machine (in-memory) |
| `source/server/admin/AdminAudit.service.ts` | 63 | Admin audit ring buffer |
| `source/server/admin/AdminAntiCheat.service.ts` | 210 | Anti-cheat heuristics + heartbeat |
| `source/server/admin/AdminPovCapture.service.ts` | 359 | Screenshot capture + export |
| `source/server/admin/AdminLog.manager.ts` | 172 | Damage/kill log ring buffers |
| `source/client/modules/Noclip.module.ts` | ~396 | Client noclip flight |
| `source/client/modules/AdminESP.module.ts` | 89 | ESP overlay |
| `source/client/modules/AdminGodmode.module.ts` | 12 | Godmode binding |
| `source/client/modules/AdminPovCapture.module.ts` | 120 | Screenshot + CEF encode |
| `source/client/classes/Spectate.class.ts` | 118 | Spectate logic |

---

## 1. Critical Findings

### C-01 — Plaintext credentials committed to repository
**File:** `ragemp-server/.env`  
**Lines:** 1–10

```
DB_PASS=Headshot123
DB_BETA_PASSWORD=Headshot123
DISCORD_CLIENT_SECRET=38a5hJt77ZO8dW1QyQGC_LECcbXVVUx7
DISCORD_CLIENT_ID=1495494966309552148
```

The `.env` file is committed to the repository and contains:
- PostgreSQL database password in plaintext (`Headshot123`)
- Discord OAuth2 client secret in plaintext
- Discord OAuth2 client ID

**Impact:** Full database access to anyone with repository access. Discord OAuth flow can be hijacked to impersonate the application. If this repository is public, secrets must be considered compromised immediately.  
**Fix:** Rotate all credentials. Add `.env` to `.gitignore`. Use environment injection at deploy time (CI secrets, Docker secrets, etc.). Never re-commit `.env`.

---

### C-02 — Admin audit log is in-memory only; lost on every restart
**File:** `source/server/admin/AdminAudit.service.ts`, lines 9–17

```typescript
const MAX_ENTRIES = 2000;
const entries: AuditEntry[] = [];

function pushBounded(entry: AuditEntry): void {
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift(); // oldest entry evicted
}
```

All admin actions (ban, kick, warn, heal, freeze, give weapon, vehicle spawn, etc.) are written only to this ring buffer. On server restart, the entire audit history is erased. Additionally, a busy admin session producing >2000 entries evicts earlier entries, making it impossible to reconstruct actions taken before the buffer rolled over.

**Impact:** A rogue admin can take destructive actions (mass bans, map deletions) then restart the server to erase the audit trail. There is no persistent accountability.  
**Fix:** Persist audit entries to a database table or append-only log file. Keep the ring buffer for the in-panel UI view only.

---

### C-03 — Report system is entirely in-memory; all reports lost on restart
**File:** `source/server/report/Report.manager.ts`, lines 49–50

```typescript
const reports: ReportEntry[] = [];
let nextId = 1;
```

Every `ReportEntry` — including subject, message, chat history, claim/close audit trail, and reporter identity — lives only in this module-level array. A server crash or intentional restart wipes all open and historical reports.

**Impact:** Players filing reports mid-session lose their case history. Staff cannot follow up after any server downtime. A bad actor with server access (or the ability to trigger a crash) can destroy evidence contained in reports.  
**Fix:** Persist reports to a database table. The existing `ReportEntry` shape maps cleanly to a relational schema.

---

## 2. High Findings

### H-01 — POV frame chunks have no per-chunk size cap
**File:** `source/server/admin/AdminPovCapture.service.ts`, lines 307–327  
**File:** `source/client/modules/AdminPovCapture.module.ts`, lines 77–86

Server handler for `server::admin:pov:frameBegin`:
```typescript
const totalChunks = Number(totalChunksRaw);
if (!Number.isFinite(totalChunks) || totalChunks <= 0 || totalChunks > 5000) return;
pendingFrameChunks.set(requestId, {
    totalChunks,
    chunks: new Array(totalChunks),  // pre-allocated
    startedAt: Date.now(),
});
```

Server handler for `server::admin:pov:frameChunk`:
```typescript
pending.chunks[index] = String(chunkRaw ?? "");  // no size check
```

The server enforces a `totalChunks <= 5000` bound, but places **no limit on the byte size of each individual chunk string**. The client sends chunks of `FRAME_CHUNK_SIZE = 6000` characters each, which is legitimate, but a malicious target being watched by an admin (i.e., a player with an active POV session) can send 5000 chunks of arbitrary size.

**Impact:** A target player could exhaust server memory or fill disk (on export) by responding to a capture request with oversized chunks. This requires an active watch session initiated by an admin, narrowing but not eliminating the attack surface.  
**Fix:** Cap individual chunk byte length server-side (e.g., ≤ 8000 bytes per chunk). Cap total assembled frame size (e.g., ≤ 4 MB). Add a cap on total frames per session.

---

### H-02 — Zone editor destructive operations produce no audit log entries
**File:** `source/server/serverevents/Admin.event.ts`, lines 929–982

`hopoutsZoneEditorDelete` and `hopoutsZoneEditorDeleteMap` (which permanently deletes a preset, all zones, and all runtime config for a map) contain no call to `auditLog()`. The operations are gated at `isZoneEditorStaff` (adminLevel ≥ 6), but once executed they leave no trace in the audit ring buffer.

**Impact:** A level-6 admin can silently delete all arena maps. Combined with C-02 (audit log not persisted), there is no recovery path for identifying who deleted what.  
**Fix:** Call `auditLog()` before executing any destructive zone editor operation, including `hopoutsZoneEditorSave`, `hopoutsZoneEditorDelete`, `hopoutsZoneEditorDeleteMap`.

---

### H-03 — Anti-cheat flag history cleared on playerQuit
**File:** `source/server/admin/AdminAntiCheat.service.ts`, lines 175–181

```typescript
mp.events.add("playerQuit", (player: PlayerMp) => {
    flagHistory.delete(player.id);
    clientHeartbeat.delete(player.id);
    // ...
});
```

All anti-cheat flags (rapid kill chains, high hit cadence, long-range streaks, headshot streaks, heartbeat timeouts) accumulated for a player are deleted the moment they disconnect. A cheating player accumulating strikes can reset their entire flag record simply by disconnecting and reconnecting.

The heartbeat strike counter is also zeroed on reconnect, so a client ignoring heartbeats gains a clean slate every session.

**Impact:** Anti-cheat heuristics are ineffective across sessions. Patterns that should trigger deeper investigation are invisible if the player disconnects before an admin reviews them.  
**Fix:** Persist flag history and heartbeat strikes to a database (keyed by account or serial). On connect, reload the player's flag history so the session isn't a clean slate.

---

### H-04 — CEF debugging enabled in production config
**File:** `ragemp-server/conf.json`, line 6

```json
"allow-cef-debugging": true
```

With CEF debugging enabled, the Chromium DevTools protocol is exposed on a local port (typically 9222). Anyone with local network access (or loopback access on a VPS) can attach Chrome DevTools to the server's CEF processes, inspect the admin panel DOM, read CEF event payloads, and potentially inject JavaScript into admin sessions.

**Impact:** On a multi-user VPS or if the debug port is inadvertently exposed, attackers can read all data flowing through the admin CEF panel — including report contents, player details, and admin chat — without authentication.  
**Fix:** Set `"allow-cef-debugging": false` in any non-development environment. Gate this on a `NODE_ENV` check or a separate config file that is not committed.

---

## 3. Medium Findings

### M-01 — Report creation has no time-based rate limit
**File:** `source/server/report/Report.manager.ts`, lines 60–62  
**File:** `source/server/serverevents/Report.event.ts`, lines 101–103

```typescript
export function getOpenCountForPlayer(playerId: number): number {
    return reports.filter((r) => r.reporterId === playerId && r.status !== "closed").length;
}
// submit handler:
if (getOpenCountForPlayer(player.id) >= 3) { return error; }
```

The rate limit is count-based only: a player may not have more than 3 non-closed reports simultaneously. Once staff closes all 3, the player can immediately submit 3 more. There is no cooldown between cycles, no cap on total reports submitted per hour, and no detection of repeat identical submissions.

**Impact:** A disruptive player can flood the staff queue in waves: submit 3 → wait for staff to close → submit 3 more, indefinitely. Combined with C-03 (no persistence), staff have no historical view to identify repeat offenders.  
**Fix:** Track `lastReportAt` per player. Enforce a minimum interval (e.g., 2 minutes between reports). Optionally track total reports submitted per hour.

---

### M-02 — Heartbeat nonce is not cryptographically secure
**File:** `source/server/admin/AdminAntiCheat.service.ts`, lines 62–65

```typescript
function makeHeartbeatNonce(player: PlayerMp, now: number): string {
    const rand = Math.floor(Math.random() * 1_000_000_000);
    return `${player.id}:${now}:${rand}`;
}
```

`Math.random()` is a pseudo-random number generator seeded at runtime and is not cryptographically unpredictable. The nonce format encodes the player ID (public) and the current timestamp (predictable within a narrow window). A sophisticated modded client with knowledge of V8's PRNG state could predict upcoming nonces and pre-compute responses.

**Impact:** A determined cheating client could pass heartbeat checks without actually executing the challenge, undermining the only active-verification mechanism in the anti-cheat system.  
**Fix:** Use `crypto.randomBytes(16).toString('hex')` for nonce generation. The resulting nonce should be opaque and unpredictable regardless of player ID or timing.

---

### M-03 — reportedPlayerId / reportedPlayerName not validated
**File:** `source/server/serverevents/Report.event.ts`, lines 96–112

```typescript
const { category, subject, message, reportedPlayerId = null, reportedPlayerName = null } = d;
const report = createReport(
    player.id, player.name ?? "Unknown",
    category, subject.trim(), message.trim(),
    reportedPlayerId ?? null,
    reportedPlayerName ?? null   // client-supplied, not verified
);
```

The `reportedPlayerId` and `reportedPlayerName` are accepted directly from the client payload without verifying that:
1. The player ID is actually online at time of submission.
2. The name matches the player with that ID.

**Impact:** A player can create a report with a fabricated target name (e.g., `reportedPlayerId: 5, reportedPlayerName: "Admin_Bob"`), which appears in the staff queue attributed to the wrong person.  
**Fix:** On submission, if `reportedPlayerId` is provided, look up `mp.players.at(reportedPlayerId)` and overwrite `reportedPlayerName` with the server-authoritative `target.name`. Reject the report if the ID doesn't match an online player.

---

### M-04 — Report message body and subject have no length limit
**File:** `source/server/serverevents/Report.event.ts`, lines 108–110  
**File:** `source/server/report/Report.manager.ts`, lines 179–188

`addChatMessage` trims the message but applies no length cap. The submit handler trims subject and message but applies no maximum length.

**Impact:** A player could submit a report with a megabyte-length message body or chat messages of arbitrary size, consuming server memory proportional to how many reports accumulate.  
**Fix:** Enforce server-side limits: subject ≤ 128 characters, message body ≤ 1000 characters, chat messages ≤ 500 characters.

---

### M-05 — Admin panel open and admin duty toggle are not logged
**File:** `source/server/serverevents/Admin.event.ts`, lines 415–433 (admin panel open)  
**File:** `source/server/commands/Admin.commands.ts`, lines 160–172 (adminmode toggle)

Neither opening the admin panel nor toggling admin duty mode (which makes the `[ADMIN]` overhead tag visible) writes an `auditLog()` entry. The audit log captures commands like ban/kick/heal but misses the panel session boundary.

**Impact:** An investigation into admin activity cannot determine when a session began, which tabs were visited, or when duty mode was enabled. Combined with C-02, this leaves gaps in accountability.  
**Fix:** Call `auditLog()` with action `"panel_open"` / `"duty_on"` / `"duty_off"` at the relevant event handlers.

---

### M-06 — No rate limiting on admin commands (ban, kick, heal-all, etc.)
**File:** `source/server/commands/Admin.commands.ts`, all command handlers

Admin commands like `/ban`, `/kick`, `/heal all`, `/freeze all`, and `/announce` have no rate limiting. A compromised or rogue admin account can issue these in rapid succession.

**Impact:** A compromised admin account can ban the entire player list in seconds, heal/freeze all players repeatedly, or flood the chat with announcements with no server-side throttle.  
**Fix:** Implement a per-admin, per-command cooldown (e.g., 1s for most commands; 5s for mass-affect commands like `heal all`). Track last-use timestamps in a server-side map.

---

## 4. Trust-Boundary Findings

### T-01 — Noclip: client hasAccess() reads server-set player variable — SAFE
**File:** `source/client/modules/Noclip.module.ts`, lines 85–88  
**File:** `source/server/serverevents/Player.event.ts`, lines 363–369

```typescript
// Client:
const hasAccess = (): boolean => {
    const adminLevel = Number(mp.players.local.getVariable("adminLevel") ?? 0);
    return Number.isFinite(adminLevel) && adminLevel > 0;
};

// Server (state broadcast event):
mp.events.add("server::player:noclip", (player: PlayerMp, status) => {
    if (player.getAdminLevel() < 1) return;  // server re-verifies
    player.setVariable("noclip", status);
    // broadcast to nearby clients
});
```

The client `hasAccess()` reads `adminLevel` via `mp.players.local.getVariable()`. In RAGE:MP, `player.setVariable` is a server-only API; clients cannot write player variables. Therefore the `adminLevel` variable cannot be spoofed by the client. The `/noclip` command is also gated server-side at `LEVEL_ONE`. The state broadcast event re-verifies `getAdminLevel() < 1`.

**Assessment:** The trust chain is intact under standard RAGE:MP guarantees. A modded client could invoke the client event `client::noclip:toggle` directly (skipping the command), but `hasAccess()` would return false (adminLevel = 0 for non-admins), and even if they forced noclip locally, the server state broadcast would be rejected.

**UNVERIFIED AGAINST LIVE DOCS:** Whether `getVariable()` is truly read-only client-side in all RAGE:MP versions should be confirmed.

---

### T-02 — ESP: reads server-set adminLevel variable — SAFE
**File:** `source/client/modules/AdminESP.module.ts`, lines 14–16, 25–27, 82

```typescript
private setMode(mode: number) {
    if (!localPlayer.getVariable("adminLevel")) return;
    // ...
}
private get mode() {
    if (!localPlayer.getVariable("adminLevel")) return 0;
    // ...
}
```

Same analysis as T-01. `adminLevel` is server-set. The `/esp` command is gated at `LEVEL_ONE` server-side and sets `adminEspMode` server variable then calls the client event. Client cannot self-enable without the server-set `adminLevel`.

**Assessment:** SAFE under standard RAGE:MP guarantees.

---

### T-03 — Godmode: Admin-SetGM client event can be self-invoked by modded client
**File:** `source/client/modules/AdminGodmode.module.ts`, lines 4–7

```typescript
mp.events.add("Admin-SetGM", (enabled: boolean) => {
    if (!mp.players.local) return;
    mp.players.local.setInvincible(!!enabled);
});
```

A modded client can invoke `mp.events.call("Admin-SetGM", true)` locally, calling the GTA V native `SET_ENTITY_INVINCIBLE` on themselves without going through the server.

**Assessment:** This is a fundamental RAGE:MP/GTA:V trust boundary: client-side natives cannot be made server-authoritative. The `AGM` data handler also applies invincibility from the server-set `AGM` variable, which IS server-authoritative. However, the raw `Admin-SetGM` local event binding is exploitable by any modded client — regardless of admin status — to achieve local invincibility.

**Note:** This is a game-engine-level limitation, not unique to this codebase. Anti-cheat solutions typically detect invincibility via damage registration discrepancies rather than trying to prevent the native call.

---

### T-04 — POV requestId check is weak but bounded by session existence
**File:** `source/server/admin/AdminPovCapture.service.ts`, lines 295, 309–310

```typescript
if (!requestId || !String(requestId).startsWith(`${player.id}_`)) return;
```

The requestId format is `{playerId}_{timestamp}`. The check only verifies the prefix, so a player could fabricate a valid-looking requestId (`5_99999999999`). However, the prior check `sessions.get(player.id)` ensures the frame is only accepted if the player has an active watch session (initiated by admin). A player without an active session cannot inject frames at all.

**Assessment:** MEDIUM risk, not critical. The session guard is the effective control. The requestId check adds minimal additional value as currently written.

---

### T-05 — Admin spectate state payload passed to CEF with no schema validation
**File:** `source/client/classes/Spectate.class.ts`, lines 104–110

```typescript
private onAdminSpectateState(data: string) {
    try {
        const payload = typeof data === "string" ? JSON.parse(data) : data;
        Browser.processEvent("cef::adminSpectate:setState", payload);
    } catch {
        /* ignore malformed admin spectate payloads */
    }
}
```

The parsed payload is forwarded directly to `Browser.processEvent` without shape or type validation. If the CEF page's `cef::adminSpectate:setState` handler renders any field of this payload as HTML without escaping, an admin who sends a crafted spectate start event could inject content into other admins' CEF panels.

**Assessment:** Risk depends entirely on how the CEF frontend handles the payload. Cannot assess without frontend source. Flag for frontend review.

---

### T-06 — Admin-to-player notification via mp.players.at() without existence check (minor)
**File:** `source/server/serverevents/Report.event.ts`, lines 143–150

```typescript
const reporter = mp.players.at(claimed.reporterId);
if (reporter && mp.players.exists(reporter)) { ... }
```

The existence check IS present in most handlers. A few unchecked paths exist in the admin panel support handlers in `Admin.event.ts` (e.g., `supportClaim` line 569). These are low-severity but could cause runtime errors if the reporter disconnects between the operation and the notification.

---

## 5. RAGE:MP API / Doc Verification Notes

The following assertions in the codebase could not be verified against live RAGE:MP documentation (wiki was not consulted; findings marked UNVERIFIED):

| Assertion | File | Status |
|-----------|------|--------|
| `player.setVariable()` is server-only; clients cannot write player variables | Multiple | **UNVERIFIED** — Critical for T-01/T-02 safety claims |
| `player.getAdminLevel()` method exists as a RAGE:MP built-in | Admin.commands.ts L844 | **UNVERIFIED** — appears to be a custom extension; may shadow or wrap `account.adminlevel` |
| `RAGERP.cef.register()` isolates events per CEF page name | Admin.event.ts, Report.event.ts | **UNVERIFIED** — if isolation fails, a report-page payload could trigger admin-page handlers |
| `mp.players.at(id)` returns `null` for disconnected players (not stale handle) | Report.event.ts | **UNVERIFIED** — stale handle risk if `mp.players.exists()` is not checked |
| `player.call()` targets only the specific player's client | Admin.commands.ts L179 | **VERIFIED by RAGE:MP convention** — `player.call` sends to one client; `mp.players.broadcast` would send to all |
| `Math.random()` in Node.js is not cryptographically secure | AdminAntiCheat.service.ts L63 | **VERIFIED** — Node.js docs explicitly state `Math.random()` is not CSPRNG |
| CEF debugging port defaults to 9222 when `allow-cef-debugging: true` | conf.json | **UNVERIFIED** — port behavior depends on RAGE:MP version |

---

## 6. Runtime Test Checklist — Admin / Report Systems

### Admin Permission Enforcement
- [ ] Non-admin player cannot execute `/noclip`, `/ban`, `/kick`, `/esp`, `/goto` (should silently reject or show no permission)
- [ ] Non-admin cannot send `report.claim`, `report.close`, `report.delete`, `report.reopen` CEF events
- [ ] Non-admin cannot send `admin.toggleGodmode`, `admin.executeCommand`, `admin.getPlayerList` CEF events
- [ ] Level 1–5 admin cannot open the zone editor (`admin.openHopoutsZoneEditor` should reject)
- [ ] Level 6 admin can open zone editor and perform all zone editor actions
- [ ] `/setadmin` command requires level 6; level 1–5 admin cannot promote players

### Noclip / Spectate / ESP / Godmode
- [ ] `/noclip` activates noclip on the calling admin only; nearby players see the transparency effect
- [ ] Non-admin toggling noclip locally (if modded) does NOT update server `noclip` variable
- [ ] Admin godmode persists across dimension changes; disabling it removes invincibility
- [ ] ESP overlay renders name+distance labels for all streamed players when mode ≥ 1
- [ ] `/aspec [id]` spectates target; target sees no notification; `/aspecoff` returns correctly
- [ ] Spectating admin's position follows target player; alpha is 0 while spectating

### Report Creation / Claim / Close / Resolve
- [ ] Player can submit up to 3 open reports; 4th submission is rejected with error
- [ ] After all 3 are closed by staff, player can immediately submit 3 more (confirms no time limit — expected behavior, document as known gap)
- [ ] Staff can claim an open report; only one claim allowed per report
- [ ] Staff can unclaim, close with reason, and reopen a report
- [ ] Reporter receives in-game notification when their report is claimed, closed
- [ ] Reporter can send chat messages on their own open report; cannot on closed
- [ ] Staff can delete a report; deleted report disappears from queue
- [ ] Non-staff player cannot access `report.getAllReports` endpoint

### Report Spam / Rate Limit / Race Condition
- [ ] Two staff members claiming the same report simultaneously: only one claim should succeed (verify `claimedById != null` guard in `claimReport`)
- [ ] Two staff members closing the same report simultaneously: verify idempotency
- [ ] Rapid-fire `report.submit` calls from same player: only up to 3 should be accepted per non-closed session

### Audit Logging
- [ ] `/ban`, `/kick`, `/warn`, `/heal`, `/freeze` commands all produce entries in the audit log tab
- [ ] Audit log entries display correctly in the admin panel Logs tab
- [ ] After 2001 ban entries, the oldest entry is evicted (ring buffer confirmed working)
- [ ] **Server restart: confirm audit log is empty after restart** (documents the C-02 gap)

### Anti-Cheat / Heartbeat
- [ ] A client that does not respond to heartbeats accumulates strikes; after 3 strikes, kicked
- [ ] Heartbeat strike count resets after 10 minutes of clean responses
- [ ] A player with 3 rapid kills in 15 seconds triggers `rapid_kill_chain` flag and automatic POV export
- [ ] AC flags appear in admin panel for the flagged player
- [ ] **Player disconnect + reconnect: confirm flag history is cleared** (documents H-03 gap)

### POV Capture
- [ ] `/povwatch [id]` starts capturing screenshots at the given interval
- [ ] `/povstatus [id]` reports frame count and interval
- [ ] `/povdump [id]` exports frames to disk and produces `manifest.json` and `combat_logs.json`
- [ ] `/povclear [id]` clears buffer; subsequent `/povstatus` shows 0 frames
- [ ] Exporting with ffmpeg available produces `evidence.mp4`
- [ ] Frames older than 120 seconds are evicted from the ring buffer

### Zone Editor (Level 6 only)
- [ ] Zone editor opens only for level 6+ admins
- [ ] Saving a zone with invalid mapId (non-existent preset) is rejected
- [ ] Deleting a map removes preset, all zones, and runtime config atomically
- [ ] Capture point is rejected if admin has moved more than 4.5m from the sampled position

### Configuration
- [ ] Confirm `allow-cef-debugging` is `false` on the deployed server
- [ ] Confirm `.env` is excluded from the deployed server's git history (or not present on server)
- [ ] Confirm `DB_PASS` and `DISCORD_CLIENT_SECRET` have been rotated

---

## Summary Matrix

| ID | Severity | System | Finding | Fix Complexity |
|----|----------|--------|---------|----------------|
| C-01 | **CRITICAL** | Config | `.env` credentials committed to git | Low (rotate + gitignore) |
| C-02 | **CRITICAL** | Admin | Audit log in-memory only | Medium (DB persist) |
| C-03 | **CRITICAL** | Reports | Report system in-memory only | Medium (DB persist) |
| H-01 | High | POV | No per-chunk size cap on frame upload | Low (add byte check) |
| H-02 | High | Zone Editor | Destructive ops not audit-logged | Low (add auditLog calls) |
| H-03 | High | Anti-Cheat | Flag history cleared on disconnect | Medium (DB persist flags) |
| H-04 | High | Config | CEF debugging enabled | Low (flip config flag) |
| M-01 | Medium | Reports | No time-based report cooldown | Low |
| M-02 | Medium | Anti-Cheat | Math.random() nonce | Low (crypto.randomBytes) |
| M-03 | Medium | Reports | reportedPlayer not server-validated | Low |
| M-04 | Medium | Reports | Message length unbounded | Low (add trim+slice) |
| M-05 | Medium | Admin | Panel open / duty toggle not logged | Low |
| M-06 | Medium | Admin | No rate limiting on admin commands | Medium |
| T-01 | Trust | Noclip | Client reads server-set variable — SAFE | N/A |
| T-02 | Trust | ESP | Client reads server-set variable — SAFE | N/A |
| T-03 | Trust | Godmode | Admin-SetGM self-invocable (GTA native) | Engine-level limitation |
| T-04 | Trust | POV | Weak requestId prefix check | Low (strengthen check) |
| T-05 | Trust | Spectate | CEF spectate payload unvalidated | Frontend review needed |
