# Synthesis Plan — AUDIT_REPORT_FULL.md + AUDIT_FINDINGS_FULL.md

## Context

Nine subsystem audit files have been read and cross-referenced:
- `AUDIT_REPORT_STAGE1.md` + `AUDIT_FINDINGS_STAGE1.md` — full codebase overview (72 issues)
- `AUDIT_DAMAGE_COMBAT.md` — damage pipeline (DamageSync, CombatIntegrity, SnapshotManager)
- `AUDIT_AUTH_ACCOUNT.md` — auth/account/character/session lifecycle
- `AUDIT_ADMIN_REPORTS.md` — admin commands, reports, anti-cheat, POV capture
- `AUDIT_HOPOUTS_ZONE_SPAWNS.md` — Hopouts match lifecycle, zone, spawns, reconnect
- `AUDIT_FFA_GUNGAME_RANKED.md` — FFA/GunGame modes, stats, matchmaking, ranked
- `AUDIT_FRONTEND_CEF_UI.md` — React CEF UI, stores, HUD, Browser class
- `AUDIT_LOADOUT_CLOTHING_VEHICLES.md` — weapons, clothing, vehicles, DB persistence

Goal: produce two files in the worktree root
- `AUDIT_REPORT_FULL.md` — consolidated narrative report
- `AUDIT_FINDINGS_FULL.md` — machine-scannable merged findings list

No code modifications. Synthesis only.

---

## Output Files: Location

Both files go at the worktree root:
`C:\Users\Matei\Downloads\arena-server-backup-master\.claude\worktrees\nervous-dirac-985e63\`

---

## AUDIT_REPORT_FULL.md — Structure

### 1. Executive Summary
- Project: Havoc Arena RAGE:MP TypeScript server, React/MobX CEF UI
- Verdict: NOT ready for public sessions
- Merged issue count: **~115 issues** (14 Critical, 41 High, 40 Medium, 20+ Low/Info)
- Top-10 blockers table (same as Stage 1, plus ADMIN-C03 report persistence and CRIT-02 stat races)
- Note about RAGE:MP wiki being 403 — all RAGE:MP API findings carry UNVERIFIED label unless cross-confirmed

### 2. Repo/System Inventory
- Architecture diagram (verbatim from Stage 1)
- Component inventory table (expanded with Loadout/Vehicle/Admin files)
- External dependency risk table

### 3. RAGE:MP API Compliance Findings
Table of all API usages with VERIFIED CORRECT / HIGH-CONFIDENCE BUG / UNVERIFIED status:

| API | Finding | Status |
|-----|---------|--------|
| `mp.players.at(id)` used with remoteId | Hits wrong player — C01 | HIGH-CONFIDENCE BUG |
| `mp.players.atRemoteId(id)` | Not used in damage handler | HIGH-CONFIDENCE BUG (fix) |
| `mp.gui.cursor.show(bool, bool)` | Second param locks cursor to center | HIGH-CONFIDENCE BUG |
| `BrowserMp.execute(js)` | Unescaped event name → JS injection | HIGH-CONFIDENCE BUG |
| `mp.browsers.new(url)` | Correct call; URL not validated | PLAUSIBLE RISK |
| `setInterval(fn, 0)` ×2 | CPU spin-locks | HIGH-CONFIDENCE BUG |
| `mp.game.gameplay.getGroundZFor3dCoord` | No null check on return | PLAUSIBLE RISK / NEEDS RUNTIME TEST |
| `mp.raycasting.testCapsule` | Missing optional flags param | PLAUSIBLE RISK / NEEDS RUNTIME TEST |
| `player.spawn(position)` after death | Side effects unconfirmed | UNVERIFIED AGAINST LIVE DOCS |
| `player.call(event, args[])` with 23 args | Arg count limit unknown | UNVERIFIED AGAINST LIVE DOCS |
| `mp.peds.atRemoteId` | Runtime existence check in code | PLAUSIBLE RISK / NEEDS RUNTIME TEST |
| `player.health` 0–200 range | Arena uses 100–200 range | UNVERIFIED AGAINST LIVE DOCS |
| `player.giveWeaponEx(hash, total, 30)` | Non-standard 3-arg form | UNVERIFIED AGAINST LIVE DOCS |
| `player.setVariable` server-only | Critical for T-01/T-02 safety | UNVERIFIED AGAINST LIVE DOCS |
| `CameraMp.setActive(bool)` | Correct | VERIFIED CORRECT |
| `mp.game.cam.renderScriptCams(...)` | Correct | VERIFIED CORRECT |
| `hideHudComponentThisFrame(id)` | Must be called every frame — correct | VERIFIED CORRECT |
| `mp.game.network.setInSpectatorMode` | Correct | VERIFIED CORRECT |
| `PlayerMp.setAlpha(n)` | Correct | VERIFIED CORRECT |
| `mp.gui.chat.show(false)` | Correct | VERIFIED CORRECT |
| `mp.browsers.exists(browser)` | Correct guard pattern | VERIFIED CORRECT |
| `browser.markAsChat()` | Correct | VERIFIED CORRECT |
| `mp.game.controls.setDisableControlActionBatch` | Correct | VERIFIED CORRECT |

### 4. System-by-System Findings (summary narrative, detail in AUDIT_FINDINGS_FULL.md)

#### 4.1 Combat / Damage Pipeline
- C01: Wrong API for victim lookup (entire combat broken at root)
- C04: Warmup godmode fallthrough
- C07: Dead shooter can deal damage
- C08: Weapon hash not whitelisted
- DC-M01: Undefined team → friendly fire edge case
- DC-M02: BotPedHit bypasses all CombatIntegrity validation
- DC-M03: getPedById fallback uses pool index
- DC-H14: Client-controlled bone → always-headshot exploit
- CombatIntegrity detection-only safeguards (no enforcement)
- Lag compensation: VERIFIED CORRECT design

#### 4.2 Auth / Account / Character / Session
- AUTH-C01: character::select — no auth, no ownership check (CRITICAL)
- AUTH-C02: character::create — no auth gate (CRITICAL)
- AUTH-H01: No brute-force protection on loginPlayer
- AUTH-H02: loginPlayer allows session overwrite
- AUTH-H03: Discord HTTPS client no timeout
- AUTH-H04: Discord OAuth callback no already-authed check
- AUTH-H05: creator::navigation no auth/state gate; no type check
- AUTH-H06: Discord OAuth URL no scheme validation client-side
- AUTH-M01: No DB transactions on character/account creation
- AUTH-M02: loginPlayer no input length validation
- AUTH-M03: Ban expiry parseInt NaN → silently permanent bans
- AUTH-M04: Pending token transits CEF with debugging enabled
- VERIFIED CORRECT: OAuth state management (crypto.randomBytes, TTL, consume-on-use, player binding)
- VERIFIED CORRECT: Session invalidation on disconnect

#### 4.3 Admin / Reports / Anti-Cheat
- ADMIN-C01 = C06: Plaintext .env credentials committed to repo
- ADMIN-C02 = C10: Admin audit log in-memory only
- ADMIN-C03: Report system in-memory only (NEW CRITICAL from ADMIN audit)
- ADMIN-H01: POV frame chunks no per-chunk size cap
- ADMIN-H02: Zone editor destructive ops not audit-logged
- ADMIN-H03: Anti-cheat flags cleared on disconnect
- ADMIN-H04 = H04: CEF debugging enabled in production
- ADMIN-M01: Report no time-based rate limit
- ADMIN-M02 = M07: Anti-cheat nonce Math.random()
- ADMIN-M03: reportedPlayerId not server-validated
- ADMIN-M04: Report message no length limit
- ADMIN-M05: Admin panel open/duty toggle not logged
- ADMIN-M06: No rate limiting on admin commands
- VERIFIED SAFE: Noclip/ESP trust chain (server-set adminLevel variable)
- ENGINE LIMITATION: Admin-SetGM self-invocable (GTA V native — not fixable in RAGE:MP)

#### 4.4 Hopouts / Arena / Zone / Spawns
- HOPOUTS-H1: Null dereference crash on malformed preset (redSpawn missing)
- HOPOUTS-H2: Stale disconnect grace setTimeout → premature Round N+1 end (1v1)
- HOPOUTS-H3: beginRound does not reset disconnected/roundPresenceDeadline (root cause for H2)
- HOPOUTS-M1: stormDamageBank memory leak on disconnect
- HOPOUTS-M2: outOfBoundsStart.clear() global on match lookup fail
- HOPOUTS-M3: Reconnect restores full medkit/plate count (fairness + exploit)
- HOPOUTS-M4: Reconnect gets hardcoded radius 200 regardless of zone phase
- HOPOUTS-M5: Custom zone polygon winding order not validated
- HOPOUTS-M6: Peer-Z spawn consensus skipped with <3 spawn points
- HOPOUTS-F2: 15s round resolution delay with no player feedback on disconnect
- HOPOUTS-F4: Disconnect-abuse stall tactic (deliberate exploit of F2 + H2)
- Overlaps from Stage 1: H15 (reconnect full HP), H16 (disconnect not counted as death), M01 (double round completion race), M02 (zone position client-reported), M04 (single spawn point)
- VERIFIED CORRECT (design): Storm damage bypasses armor (BR genre norm)
- NOTED: Draw rounds from simultaneous storm deaths (correct, rare, no fix)

#### 4.5 FFA / GunGame / Ranked / Stats
- CRIT-01 = C08: Weapon hash no possession check (lethal in GunGame)
- CRIT-02: Load-modify-save race on all stat counters (kills/deaths/XP/MMR lost under concurrency)
- HIGH-01: Fire-and-forget match end stats, no transaction, no retry
- HIGH-02: Concurrent addXp paths race at match end
- HIGH-03: /mydim injects admin into active match dimension without match registration
- HIGH-04 = RANK-02: updateRankedMatchResult no DB-level idempotency key
- MED-01: Party queue TOCTOU in async callers
- MED-02 = DC-H14: Headshot ratio detection warn-only
- MED-03: Zone grace timer resets on re-entry (FFA/GunGame boundary abuse)
- MED-04: ChallengeManager load-modify-save race
- MED-05: allocateDimension counter in-memory — resets on restart
- RANK-03: calculateMmrDelta silent if both isWin+isLoss true
- RANK-04: Leaderboard may lack index on mmr column
- VERIFIED CORRECT: FFA/GunGame confirmed isolated from MMR
- VERIFIED CORRECT: Rank tier boundary logic

#### 4.6 Frontend / CEF / UI / HUD
- CEF-C01 = C09: Chat XSS via dangerouslySetInnerHTML
- CEF-C02 = H21: EventManager handlers never removed in App.tsx
- CEF-C03: stopAddingHandler() misuse across all stores (never actually removes)
- CEF-C04: Browser.class.ts render event never removed
- CEF-H01 = H02: CEF execute() unescaped event name → JS injection
- CEF-H02 = H01: Cursor locked to center on every HUD tick
- CEF-H03: 35+ module-level render event handlers never removed
- CEF-H04: Hardcoded imgur URL in production bundle
- CEF-H05: 4,608 DOM nodes for TacticalCompass tape
- CEF-H06: PlayerHud render event not removed on playerQuit
- CEF-M01: Arena.store.ts orphan timeouts not tracked/cancelled
- CEF-M03: Blur state not cleared on emergencyReset()
- CEF-M04 = AUTH-H06: Discord OAuth URL no validation
- CEF-M05: AttachEditor browser never destroyed
- CEF-M06: Admin sound pool all undefined; AdminPanel 2200+ LOC monolith
- CEF-M07: Chat useEffect over-broad store dependency
- CEF-M08: 236 event adds vs 3 removes systemically

#### 4.7 Loadout / Clothing / Vehicles
- LCV-C1: No server-side weapon whitelist — RPG/minigun/etc can be granted
- LCV-C2: No tint index validation (stores/syncs arbitrary integer)
- LCV-C3 = H20: No per-player vehicle spawn limit
- LCV-H1: Component validation bypassed for weapons without attachment data
- LCV-H2: savePreset not blocked in match context
- LCV-H3 = H19: Clothing drawables no upper-bound validation
- LCV-H4: Blocked drawables list not enforced server-side
- LCV-H5: Gender/model mismatch not validated on clothing
- LCV-H6: No DB transactions on vehicle writes
- LCV-M1 = M14: Vehicle mod values unbounded
- LCV-M2: Vehicle color values unbounded
- LCV-M3: No UNIQUE constraint on vehicle plate
- LCV-M4: owner_id no FK to accounts
- LCV-M5: No rate limiting on clothing saveInline
- LCV-M6: Component desync on client-side native failure
- LCV-M7: Vehicle class field unconstrained
- LCV-P1 = L06: No TypeORM migration history
- LCV-P2: Preset components not re-validated on load
- LCV-P3: Orphaned vehicle records on crash mid-save
- LCV-P4: Clothing JSONB no schema constraint
- LCV-P5: Vehicle JSON columns not schema-validated

### 5. UI/UX Quality Summary (page-by-page)

| Page | Score | Strengths | Key Issues |
|------|-------|-----------|------------|
| Auth | 8.5/10 | GSAP boot veil, state machine clean | 6s hardcoded fallback, Discord error path leaves pending forever |
| HUD / Chat | 6/10 | Component composition clean | XSS (C01), webby aesthetic, opacity race, no rate limit on sends |
| Arena HUD | 8/10 | Multi-mode dispatcher clean, UnifiedScoreboard | 4608-node compass DOM, imgur URL, no scoreboard key hint |
| Main Menu | 7/10 | State management, proper cleanup | Escape swallow too aggressive, no load timeout, tab-switch over-emits |
| Admin Panel | 5/10 | Virtuoso for lists, AdminMiniPanel separated | 2200+ LOC monolith, webby, silent sound pool, no bulk actions, no hotkeys |
| Admin Mini Panel | 7/10 | Focused scope, GSAP scoped | Webby aesthetic, no keyboard navigation |
| Report Widget | 9/10 | Virtuoso, scoped GSAP, fuzzy search | No message rate limit, FloatingHint no Escape, timestamp heuristic fragile |

### 6. Gameplay Integrity Summary

Critical integrity failures (active/real-session risk):
1. Entire combat system broken — wrong player targeted by damage (C01)
2. Warmup godmode bypass — players can die during warmup (C04)
3. Dead player can deal damage and get kill credit (C07)
4. Character hijacking — spawn as any character in DB (AUTH-C01)
5. Weapon hash spoofing — claim any weapon's stats (C08/LCV-C1)
6. Reconnect full HP restoration mid-match (H15)
7. Disconnect-abuse: 15s stall tactic in 1v1 + stale timeout causes premature round end (HOPOUTS-H2/F4)
8. Stat race conditions — kills/deaths/XP/MMR silently lost under concurrency (CRIT-02)
9. MMR no idempotency — double-award possible on restart during finalization (HIGH-04)
10. FFA kill farming: no protection against coordinated intentional deaths (H17)

Fairness violations:
- Reconnect restores full medkit/plate count (HOPOUTS-M3)
- Zone grace timer resets on re-entry (MED-03)
- /mydim allows admin to grief active matches (HIGH-03)
- Single spawn pair: same positions every round when pool depleted (HOPOUTS-F5)

Design notes (not bugs):
- Storm damage bypasses armor (confirmed BR genre norm)
- Draw rounds from simultaneous storm deaths (correct, rare)
- FFA/GunGame confirmed isolated from ranked MMR (CORRECT)
- Rank tier boundary logic verified correct

### 7. Highest Priority Fix List

**MUST FIX IMMEDIATELY (Blockers — do not open to public)**

| Rank | ID | File:Line | Fix |
|------|----|-----------|-----|
| 1 | C01 | DamageSync.event.ts:172 | Replace mp.players.at(victimId) → mp.players.atRemoteId(victimId) |
| 2 | C06/ADMIN-C01 | gamemode/.env, ragemp-server/.env | Rotate DB password + Discord secret; add .env to .gitignore |
| 3 | AUTH-C01 | Character.event.ts:132 | Add auth gate + ownership check (character.account.id === player.account.id) |
| 4 | C09/CEF-C01 | Chat.tsx:182 | Replace dangerouslySetInnerHTML with DOMPurify.sanitize() or plain text |
| 5 | C04 | DamageSync.event.ts:244 | Add else-if guard: if (ffaMatch || gunGameMatch || hopoutsMatch) return |
| 6 | C07 | DamageSync.event.ts:170 | Add: if (shooter.getVariable("alive") === false) return |
| 7 | AUTH-C02 | Character.event.ts:148 | Add: if (!player.account) return player.kick("Not authenticated.") |
| 8 | C02 | Camera.class.ts:372 | Change setInterval(fn, 0) → setInterval(fn, 16) |
| 9 | C03 | Player.prototype.ts:97 | Add interval arg: setInterval(fn, 100) |
| 10 | ADMIN-C03 | Report.manager.ts | Persist reports to DB table |
| 11 | C10/ADMIN-C02 | AdminAudit.service.ts | Write audit entries to DB; keep ring buffer for UI only |
| 12 | AUTH-H04 | DiscordOAuthServer.ts:186, Auth.event.ts:78 | Guard: if (player.account) reject both discordStart and callback |
| 13 | AUTH-H01 | Auth.event.ts:41 | Per-player failed attempt counter; lock 60s after 5 failures |
| 14 | CRIT-02 | StatsManager.ts, ProgressionManager.ts | Replace load-modify-save with atomic SQL increments (UPDATE … SET x = x + 1) |
| 15 | H04/ADMIN-H04 | conf.json (both) | Set allow-cef-debugging: false |

**SHOULD FIX NEXT (High priority, fix before sustained play)**

| Rank | ID | File:Line | Fix |
|------|----|-----------|-----|
| 16 | C08/LCV-C1 | DamageSync.event.ts:104; WeaponPresets.service.ts | if (!weaponDamage[weaponHash]) return; enforce WEAPON_REGISTRY.enabled |
| 17 | H01/CEF-H02 | Browser.class.ts:341,378 | cursor.show(showCursor, false) |
| 18 | CEF-H01 | Browser.class.ts:416 | JSON.stringify(event) in template literal |
| 19 | AUTH-H02/M11 | Auth.event.ts:41; AccountSession.ts | if (player.account) return early — already logged in |
| 20 | AUTH-H03/H12 | discordHttps.ts:8 | req.setTimeout(10000, ...) |
| 21 | AUTH-H05 | Character.event.ts:116 | Add auth gate + typeof parsedName === "string" check on creator::navigation |
| 22 | H10 | Admin.commands.ts:670 | Add rsgId to ban record |
| 23 | HOPOUTS-H1 | ArenaSpawn.validation.ts:60 | Null guard on preset.redSpawn before fallback |
| 24 | HOPOUTS-H2/H3 | ArenaMatch.manager.ts:1198, 1590 | Reset disconnected/roundPresenceDeadline in beginRound |
| 25 | H15 | ArenaMatch.manager.ts:1102 | On reconnect, restore pre-disconnect HP/armor, not full 200/100 |
| 26 | H16 | ArenaMatch.manager.ts:1560 | Count disconnect as death in match stats |
| 27 | ADMIN-H02 | Admin.event.ts:929 | Add auditLog() before zone editor destructive operations |
| 28 | ADMIN-H03 | AdminAntiCheat.service.ts:175 | Persist flag history to DB; load on reconnect |
| 29 | H11/AUTH-M01 | Character.event.ts:154, Auth.event.ts:106 | Wrap creates in TypeORM transactions |
| 30 | HIGH-01 | FfaMatch.manager.ts:282, GunGameMatch.manager.ts:304 | Wrap per-player stat block in DB transaction |
| 31 | HIGH-03 | ArenaDev.commands.ts:330 | Add audit log entry for /mydim; block if dimension is an active match |
| 32 | HIGH-04/RANK-02 | StatsManager.ts:56 | Write match-result DB record as idempotency key before applying MMR delta |
| 33 | LCV-H3/H19 | Wardrobe.event.ts:110 | Add upper-bound check on drawable/texture against clothesLimits.ts |
| 34 | LCV-H4 | Wardrobe.event.ts | Consult wardrobeBlockedDrawables.json server-side on saveInline |
| 35 | CEF-H05 | TacticalCompass.tsx | Replace 4608-node tape with canvas/SVG looping approach |
| 36 | AUTH-M02 | Auth.event.ts:41 | if (username.length > 32 || password.length > 128) return error |
| 37 | AUTH-M03 | Player.event.ts:244 | if (!isNaN(liftMs) && hasDatePassedTimestamp(liftMs)) with NaN guard |
| 38 | ADMIN-M02/M07 | AdminAntiCheat.service.ts:63 | crypto.randomBytes(16).toString('hex') for heartbeat nonce |
| 39 | ADMIN-H01 | AdminPovCapture.service.ts:307 | Cap individual chunk byte length ≤8000; cap total frame size ≤4MB |
| 40 | DC-M02 | DamageSync.event.ts:307 | Add validateFireRate/validateDuplicateHit/validateDistance to BotPedHit handler |

**POLISH LATER (Medium/Low — quality and integrity improvements)**

| Rank | ID | Fix |
|------|-----|-----|
| 41 | HOPOUTS-M3 | Track medkitsUsed/platesUsed on MatchPlayer; restore max(0, perRound - used) on reconnect |
| 42 | MED-03/FFA-MED-03 | Zone grace timer: accumulate total OOB time, do not reset on re-entry |
| 43 | M01 | Add idempotency guard to completeRound (boolean completed flag) |
| 44 | M12/CRIT-02 | Challenge progress: same atomic increment fix |
| 45 | ADMIN-M01 | Track lastReportAt; enforce 2min minimum between report submissions |
| 46 | ADMIN-M03 | On report submission: look up reportedPlayerId server-side; overwrite name |
| 47 | ADMIN-M04 | subject ≤128 chars, message ≤1000 chars, chat messages ≤500 chars |
| 48 | ADMIN-M05 | auditLog("panel_open") / ("duty_on") / ("duty_off") |
| 49 | ADMIN-M06 | Per-admin per-command cooldown map |
| 50 | LCV-C3/H20 | Vehicle spawn: cap at 3–5 per player in freeroam |
| 51 | LCV-H2 | Block savePreset if player is in an active match |
| 52 | LCV-H5 | Validate clothing drawables against character's ped model gender |
| 53 | LCV-H6 | Wrap vehicle save/insert in TypeORM transaction |
| 54 | LCV-M3 | Add UNIQUE constraint on vehicle plate column |
| 55 | LCV-M4 | Add FK from vehicle.owner_id → account.id with cascade delete |
| 56 | LCV-M5 | Per-player cooldown (1–2s) on clothing saveInline |
| 57 | CEF-C02/C03 | Wire EventManager.removeHandler() in App.tsx cleanup and store destroyEvents() |
| 58 | CEF-M01 | Track Arena.store round/kill/death timeouts in _arenaDeathTimeouts array |
| 59 | CEF-M03 | Add mp.game.graphics.transitionFromBlurred(0) at start of emergencyReset() |
| 60 | CEF-M05 | Call editBrowser.destroy(); editBrowser = null on AttachEditor close |
| 61 | CEF-M06 | Populate SOUND_SLOTS with real asset paths; split AdminPanel into 6–8 sub-components |
| 62 | M09 | Leaderboard: add B-tree index on mmr column + server-side cache with TTL |
| 63 | H05 | Fix Camera.class.ts: resolution.y assigned to variable named width |
| 64 | H06 | Camera.destroyCamera: remove entries from this.list |
| 65 | H08 | Raycast: store interval ID; clear in destroy path |
| 66 | L01 | Plan SHA-256 migration: force password reset on next login for legacy accounts |
| 67 | L05 | Remove fqdn: "eu.loclx.io" from both conf.json files |
| 68 | L07 | Add cascade delete from account to characters at DB level |
| 69 | L10 | Add youKill/youDied setTimeout IDs to _arenaDeathTimeouts |
| 70 | L13 | Gate debug sim controls behind process.env.NODE_ENV !== "production" |

### 8. Runtime Test Checklist (merged, no duplicates)

Organized into 8 areas. Each check states the expected outcome and whether it currently passes or fails based on static analysis.

#### 8.1 Auth & Login
- [ ] Connect without auth; call server::character:select with id=1 → **EXPECT: kick** | CURRENTLY: spawns as character 1
- [ ] Connect without auth; call server::character:create → **EXPECT: kick** | CURRENTLY: teleported to creator dim
- [ ] Connect without auth; call server::creator:navigation with any name → **EXPECT: rejected** | CURRENTLY: fires changeCamera event
- [ ] Send loginPlayer 30×/s with wrong password → **EXPECT: rate-limited** | CURRENTLY: no limit
- [ ] Send loginPlayer while already logged in → **EXPECT: rejected** | CURRENTLY: session silently overwritten
- [ ] Send loginPlayer with username = 500-char string → **EXPECT: length error** | CURRENTLY: TypeORM exception
- [ ] Start Discord OAuth while already authed via password → **EXPECT: rejected** | CURRENTLY: OAuth starts; callback overwrites session
- [ ] Complete Discord OAuth callback twice (browser replay) → **EXPECT: second rejected** | CURRENTLY: correctly rejected ✓
- [ ] Start OAuth; wait 16 minutes; complete → **EXPECT: expired** | CURRENTLY: correctly expired ✓
- [ ] Disconnect mid-Discord-OAuth → **EXPECT: no hanging state** | CURRENTLY: pending cleared on quit ✓
- [ ] Simulate Discord API hang (TCP connected, no data) → **EXPECT: timeout ~10s** | CURRENTLY: hangs indefinitely

#### 8.2 Character & Ownership
- [ ] Authenticate as account A; call character::select with character owned by account B → **EXPECT: kick** | CURRENTLY: spawns as B's character
- [ ] Call character::select with non-existent id → **EXPECT: showNotify error** | CURRENTLY: correctly shows error ✓
- [ ] Authenticate; disconnect mid-character-creation (between DB save and spawnWithCharacter) → confirm orphaned row; verify recoverable on next login

#### 8.3 Damage & Combat
- [ ] Fire at enemy during 3s warmup → **EXPECT: zero damage** | CURRENTLY: full uncapped damage
- [ ] Kill a player; continue shooting corpse → **EXPECT: events rejected** | CURRENTLY: dead player can deal damage
- [ ] Send server:PlayerHit with victimId=0 → confirm which player receives damage
- [ ] Modified client always sends bone="Head" → **EXPECT: detected + action taken** | CURRENTLY: console.warn only
- [ ] Rapid-fire server:PlayerHit beyond weapon RPM → **EXPECT: fire rate limit** | CURRENTLY: limit enforced ✓
- [ ] Send weaponHash = "weapon_rpg" → **EXPECT: rejected** | CURRENTLY: accepted with defaults
- [ ] Send tint index 255 → **EXPECT: clamped** | CURRENTLY: stored and synced

#### 8.4 Match Lifecycle (Hopouts)
- [ ] Disconnect Player A in Round N (alive=true); let Round N end; wait for Round N+1 active; wait 15s → **EXPECT: Round N+1 continues** | CURRENTLY: Round N+1 ends prematurely (H2/H3)
- [ ] Use all 3 medkits; disconnect; reconnect within 60s → **EXPECT: medkit count preserved** | CURRENTLY: restored to 3
- [ ] Both teams reach win condition AND round timer expires simultaneously → **EXPECT: score increments once** | CURRENTLY: potential double-increment (M01)
- [ ] Zone damage kills last player on a team → **EXPECT: round ends, no killer credited** | CURRENTLY: kill log incomplete (M03)
- [ ] Upload preset JSON with center:null and redSpawn:null → **EXPECT: no crash** | CURRENTLY: TypeError crash (H1)
- [ ] Reconnect during Phase 3 (radius 70) → **EXPECT: client shows radius 70** | CURRENTLY: shows 200 until next tick (M4)

#### 8.5 FFA / GunGame
- [ ] Modified client sends weapon_heavysniper_mk2 hash while at GunGame tier 0 → **EXPECT: rejected** | CURRENTLY: accepted, higher damage cap
- [ ] Trigger 10 kills rapid-fire near match end → check DB XP gain = exactly 10×10+150=250 (CRIT-02 race test)
- [ ] Call endMatch twice for same dimension → **EXPECT: stats written once** | CURRENTLY: in-memory guard fires ✓ (but not DB-level)
- [ ] Oscillate on FFA zone boundary every ~7s → **EXPECT: forced out after 8s total** | CURRENTLY: timer resets on re-entry
- [ ] Complete FFA match; query player_stats.mmr before/after → **EXPECT: unchanged** | CURRENTLY: correctly isolated ✓

#### 8.6 Admin / Reports / Anti-Cheat
- [ ] Non-admin sends server::admin:espMode → **EXPECT: rejected** | CURRENTLY: server-side check present ✓
- [ ] Non-admin sends server::player:noclip → **EXPECT: rejected** | CURRENTLY: server-side check present ✓
- [ ] Server restart → **EXPECT: audit log empty** (documents C10/ADMIN-C02 known gap)
- [ ] Server restart → **EXPECT: all reports gone** (documents ADMIN-C03 known gap)
- [ ] Player accumulates 3 anti-cheat flags; disconnects and reconnects → **EXPECT: flags persist** | CURRENTLY: flags cleared on disconnect
- [ ] /ban with IP+serial change by banned player → **EXPECT: ban enforced** | CURRENTLY: bypassed if rsgId not in ban record (H10)
- [ ] Report with fabricated reportedPlayerName → **EXPECT: server uses authoritative name** | CURRENTLY: client name accepted
- [ ] Submit report body with 10KB message → **EXPECT: truncated/rejected** | CURRENTLY: unlimited

#### 8.7 Loadout / Clothing / Vehicles
- [ ] Call equipToFreeroam with weapon_rpg → **EXPECT: blocked** | CURRENTLY: likely granted (C-1)
- [ ] Call saveInline with drawable=2147483647 → **EXPECT: rejected** | CURRENTLY: stored in DB (H-3)
- [ ] Call saveInline with blocked drawable from wardrobeBlockedDrawables.json → **EXPECT: rejected** | CURRENTLY: accepted (H-4)
- [ ] Spawn 50 vehicles on one character → **EXPECT: limit enforced** | CURRENTLY: no limit (C-3)
- [ ] Create two vehicles with identical plates → **EXPECT: DB error** | CURRENTLY: both stored (M-3)
- [ ] Delete account; verify vehicle rows → **EXPECT: cascade delete** | CURRENTLY: orphaned rows (M-4)

#### 8.8 CEF / UI
- [ ] Chat: paste `<img src=x onerror=alert(1)>` → **EXPECT: escaped** | CURRENTLY: XSS executes (C01)
- [ ] Open main menu → close → open rapidly ×5 → **EXPECT: no orphaned handlers**
- [ ] Open chat (T); type; Escape → **EXPECT: mouselook resumes, cursor gone**
- [ ] Open any UI → move mouse → **EXPECT: cursor tracks freely to screen edges** | CURRENTLY: locked to center (H01)
- [ ] Trigger emergency reset while world is blurred → **EXPECT: blur clears** | CURRENTLY: blur persists (M03)
- [ ] Trigger system:setPage arena_hud before arena:setMatch sent → **EXPECT: graceful empty state** | CURRENTLY: null screen (M16)
- [ ] Trigger notification during Discord OAuth → **EXPECT: spinner unaffected** | CURRENTLY: spinner resets (L17)
- [ ] Check TacticalCompass paint time in DevTools → **EXPECT: <4ms** | CURRENTLY: likely >4ms on low-end (H05)
- [ ] Vote screen with empty voteMaps → **EXPECT: empty state message** | CURRENTLY: blank grid (L11)

### 9. Appendix / Raw Verification Notes
- Source audit file index with dates and auditor
- Wiki access note (HTTP 403 during all audits — training data only)
- Complete list of VERIFIED CORRECT items
- Complete list of ENGINE LIMITATIONS (not fixable)
- Complete list of DESIGN CHOICES (not bugs)
- Cross-reference table: Stage 1 IDs ↔ subsystem IDs

---

## AUDIT_FINDINGS_FULL.md — Structure

This is the machine-scannable merged findings list.

### Header
- Date compiled, source files, status legend

### Status Legend
```
VERIFIED CORRECT — code is unambiguously correct regardless of runtime
HIGH-CONFIDENCE BUG — code logic is definitively broken by static analysis
HIGH-CONFIDENCE RISK — security or data risk confirmed by code; not mitigated
PLAUSIBLE RISK / NEEDS RUNTIME TEST — depends on RAGE:MP runtime behavior
UNVERIFIED AGAINST LIVE DOCS — behavior depends on live API; wiki 403
ENGINE LIMITATION — GTA V/RAGE:MP fundamental constraint; not fixable in application code
DESIGN CHOICE — intentional behavior; noted for operator awareness
```

### Section 1: Critical Findings (merged, 14 total)

| Canonical ID | Source IDs | File:Line | Title | Status |
|---|---|---|---|---|
| **F-C01** | C01, DC-C01, CRIT-01 | DamageSync.event.ts:172 | mp.players.at() used with remoteId — entire combat broken | HIGH-CONFIDENCE BUG |
| **F-C02** | C02 | Camera.class.ts:372 | setInterval(fn, 0) CPU spin-lock — camera rotation | HIGH-CONFIDENCE BUG |
| **F-C03** | C03 | Player.prototype.ts:97 | setInterval(fn) no interval arg — weapon wheel spin-lock | HIGH-CONFIDENCE BUG |
| **F-C04** | C04, DC-C04 | DamageSync.event.ts:244 | Warmup godmode bypass — warmup falls through to freeroam damage block | HIGH-CONFIDENCE BUG |
| **F-C05** | C05, AUTH-C01 | Character.event.ts:132 | Character hijacking — no auth or ownership check on character::select | HIGH-CONFIDENCE BUG |
| **F-C06** | C06, ADMIN-C01 | gamemode/.env, ragemp-server/.env | Plaintext DB password + Discord secret committed to repo | HIGH-CONFIDENCE RISK |
| **F-C07** | C07, DC-C07 | DamageSync.event.ts:170 | Dead shooter can deal damage — no alive check on shooter | HIGH-CONFIDENCE BUG |
| **F-C08** | C08, DC-C08, CRIT-01 | DamageSync.event.ts:104; WeaponPresets.service.ts | Weapon hash not validated — unknown/any hash accepted | HIGH-CONFIDENCE BUG |
| **F-C09** | C09, CEF-C01 | Chat.tsx:182 | Chat XSS — dangerouslySetInnerHTML with unsanitized server HTML | HIGH-CONFIDENCE RISK |
| **F-C10** | C10, ADMIN-C02 | AdminAudit.service.ts | Admin audit log in-memory only — lost on every restart | HIGH-CONFIDENCE RISK |
| **F-C11** | AUTH-C02, H13 | Character.event.ts:148 | character::create has no authentication gate | HIGH-CONFIDENCE BUG |
| **F-C12** | ADMIN-C03 | Report.manager.ts:49 | Report system entirely in-memory — all reports lost on restart | HIGH-CONFIDENCE RISK |
| **F-C13** | CRIT-02, M12 | StatsManager.ts:106, ProgressionManager.ts:89 | Load-modify-save race on all stat counters — kills/XP/MMR silently lost | HIGH-CONFIDENCE BUG |
| **F-C14** | LCV-C1 | WeaponPresets.service.ts | No server-side weapon whitelist — RPG/heavy weapons can be granted | HIGH-CONFIDENCE BUG |

### Section 2: High Findings (merged, 41 total)
Full table with same columns. Key new entries vs Stage 1:
- F-H-AUTH04, F-H-AUTH05 (auth scope)
- F-H-ADMIN01 through F-H-ADMIN04 (admin scope)
- F-H-HOPOUTS1 through F-H-HOPOUTS3 (hopouts scope)
- F-H-FFA01 through F-H-FFA04 (FFA/GunGame scope)
- F-H-LCV01 through F-H-LCV06 (loadout scope)
- F-H-CEF01 through F-H-CEF06 (frontend scope)

### Section 3: Medium Findings (merged, ~40 total)
Full table.

### Section 4: Low / Info Findings (merged, ~25 total)
Full table.

### Section 5: Verified Correct Items
| Item | Location | Assessment |
|------|----------|------------|
| Discord OAuth state (randomBytes, TTL, consume-once, player-binding) | discordAuthState.ts | VERIFIED CORRECT |
| Session invalidation on disconnect | Player.event.ts onPlayerJoin/Quit | VERIFIED CORRECT |
| Noclip trust chain (adminLevel server-set variable) | Noclip.module.ts + Player.event.ts | VERIFIED CORRECT |
| ESP trust chain | AdminESP.module.ts | VERIFIED CORRECT |
| player.call() targets one client | Admin.commands.ts | VERIFIED CORRECT |
| Math.random() is NOT CSPRNG | AdminAntiCheat.service.ts | VERIFIED (Node.js docs) |
| Lag compensation design (server snapshots, not client position) | SnapshotManager.ts, DamageSync.event.ts | VERIFIED CORRECT |
| FFA/GunGame isolated from ranked MMR | FfaMatch/GunGameMatch managers | VERIFIED CORRECT |
| Rank tier boundary logic | StatsManager.ts:33 | VERIFIED CORRECT |
| Double-end match guard (in-memory) | ArenaMatch.manager.ts, endFfaMatch/endGunGGame | VERIFIED CORRECT (in-memory only) |
| Storm damage bypasses armor | ZoneSystem.ts:225 | DESIGN CHOICE (BR norm) |
| Draw round on simultaneous storm deaths | ArenaMatch.manager.ts:1319 | VERIFIED CORRECT (by design) |
| getInitialPageFromSearchParams as lazy initializer | PageContext.tsx:40 | VERIFIED CORRECT (React pattern) |
| browser.markAsChat() | Browser.class.ts | VERIFIED CORRECT |
| mp.game.controls.setDisableControlActionBatch | Browser.class.ts | VERIFIED CORRECT |
| hideHudComponentThisFrame every frame | HUD modules | VERIFIED CORRECT |

### Section 6: Engine Limitations
| Item | Assessment |
|------|------------|
| Admin-SetGM local event self-invocable (SET_ENTITY_INVINCIBLE native) | ENGINE LIMITATION — GTA V native cannot be server-authoritative; detect via damage discrepancy |

### Section 7: Ranked Fix Priority List
(Same as section 7 of AUDIT_REPORT_FULL.md — verbatim copy for standalone use)

### Section 8: Runtime QA Checklist
(Same as section 8 of AUDIT_REPORT_FULL.md — verbatim copy)

---

## Deduplication Map (key merges)

| Stage 1 ID | Subsystem ID | Canonical ID | Notes |
|---|---|---|---|
| C01 | DC-C01, CRIT-01 | F-C01 | Same root cause, three independent confirmations |
| C04 | DC-C04 | F-C04 | Same; DC audit adds state table |
| C05 | AUTH-C01 | F-C05 | Same |
| C06 | ADMIN-C01 | F-C06 | Same file; ADMIN adds Discord secret detail |
| C07 | DC-C07 | F-C07 | Same |
| C08 | DC-C08, CRIT-01 (partial) | F-C08 | Stage 1 = server whitelist; LCV = server whitelist in loadout; DC = fallback behavior |
| C09 | CEF-C01 | F-C09 | Same |
| C10 | ADMIN-C02 | F-C10 | Same |
| H13 | AUTH-C02 | F-C11 | Severity elevated to CRITICAL by AUTH audit direct code review |
| M12 | CRIT-02 | F-C13 | Severity elevated to CRITICAL by FFA audit |
| H20 | LCV-C3 | Merged HIGH | Both confirm same vehicle spawn limit gap |
| H19 | LCV-H3 | Merged HIGH | Both confirm clothing bounds issue |
| M14 | LCV-M1 | Merged MEDIUM | Both confirm vehicle mod bounds |
| H12 | AUTH-H03 | Merged HIGH | Same discordHttps.ts finding |
| M07 | ADMIN-M02 | Merged MEDIUM | Same Math.random() nonce |
| H01 | CEF-H02 | Merged HIGH | Same cursor.show() issue |
| H02 | CEF-H01 | Merged HIGH | Same browser.execute() injection |
| H03 | AUTH-H06, CEF-M04 | Merged HIGH | Same Discord URL validation gap |
| H11 | AUTH-M01 | Merged (HIGH) | Same transactions gap |
| H14 | DC-H14, MED-02 | Merged HIGH | Same bone multiplier exploit |
| L06 | LCV-P1 | Merged LOW | Same migration gap |
| AUTH-H02 | M11 | Merged HIGH (elevated) | Same session overwrite; AUTH audit elevates |

---

## Execution Notes

After ExitPlanMode is approved:
1. Write AUDIT_REPORT_FULL.md to worktree root (~600–800 lines)
2. Write AUDIT_FINDINGS_FULL.md to worktree root (~500–700 lines)
3. No code files modified
4. Cross-references between the two files should use `See AUDIT_FINDINGS_FULL.md §X`
   and `See AUDIT_REPORT_FULL.md §Y` conventions for linked reading
