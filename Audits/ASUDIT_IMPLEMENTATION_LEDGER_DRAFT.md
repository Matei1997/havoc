\# Plan: AUDIT\_IMPLEMENTATION\_LEDGER.md + FIX\_PASS\_1\_SCOPE.md



\## Context

All nine subsystem audit files have been read in full. The AUDIT\_FINDINGS\_FULL.md merged priority table and AUDIT\_OF\_AUDITS\_WIKI\_RECHECK.md correction layer have also been read. This plan describes exactly what will be written into the two output files and where.



\---



\## Output file locations



| File | Path |

|------|------|

| `AUDIT\_IMPLEMENTATION\_LEDGER.md` | `C:\\Users\\Matei\\Downloads\\arena-server-backup-master\\Audits\\AUDIT\_IMPLEMENTATION\_LEDGER.md` |

| `FIX\_PASS\_1\_SCOPE.md` | `C:\\Users\\Matei\\Downloads\\arena-server-backup-master\\Audits\\FIX\_PASS\_1\_SCOPE.md` |



\---



\## Source file → canonical ID mapping



All canonical IDs come from `AUDIT\_FINDINGS\_FULL.md`. Subsystem-only IDs (AUTH-H01, LCV-C3, HOPOUTS-H1, etc.) that were NOT merged into the F-xxx table are given new ledger-local IDs (prefixed `LED-`) where needed.



\---



\## AUDIT\_IMPLEMENTATION\_LEDGER.md — full item list per fix pass



\### Header block

\- Generation date, source audits list, wiki correction status note (F-C01 API claim disputed per AUDIT\_OF\_AUDITS\_WIKI\_RECHECK.md §3A)

\- Confidence legend (5 values)

\- Fix pass legend



\---



\### Fix Pass 1 — Clear security / session issues (18 items)



All 18 items are `confirmed code bug` or `confirmed security risk`. None depend on uncertain RAGE:MP API behavior.



| Ledger ID | Canonical ID | Subsystem | Sev | Confidence | Source audit file | Affected source files | Lines | Problem | Why it matters | Fix direction | Safe now | Pass |

|-----------|--------------|-----------|-----|------------|-------------------|-----------------------|-------|---------|----------------|---------------|----------|------|

| LED-001 | F-C06 | Config | CRITICAL | confirmed security risk | AUDIT\_ADMIN\_REPORTS.md | `ragemp-server/.env`, `gamemode/.env` | 1–8 | DB password + Discord OAuth secret committed to repo backup in plaintext | Full DB access + Discord OAuth hijack for anyone with repo access; if public: must treat as compromised | Rotate all credentials; add `.env` to `.gitignore`; use CI/env-injection at deploy | YES — no code change needed for rotation; config change only | Pass 1 |

| LED-002 | F-H04 | Config | HIGH | confirmed security risk | AUDIT\_ADMIN\_REPORTS.md | `ragemp-server/conf.json`, `gamemode/conf.json` | line 6 (both) | `"allow-cef-debugging": true` in production config | Chromium DevTools exposed; any user with local/network access can inspect admin panel DOM, inject JS into admin CEF sessions, read pending token values | Set `"allow-cef-debugging": false` in any non-dev config | YES — single config line | Pass 1 |

| LED-003 | F-C05 | Auth / Session | CRITICAL | confirmed code bug | AUDIT\_AUTH\_ACCOUNT.md | `source/server/serverevents/Character.event.ts` | 132–144 | `character::select` handler has no `player.account` check and no `character.account.id === player.account.id` ownership check; any client (including unauthenticated) can call `server::character:select` with any numeric DB id and spawn as that character | Any player can impersonate any character in the DB; combined with LED-004 (unauthenticated player), full pre-auth identity theft | Add auth gate `if (!player.account) return player.kick(...)` then load with `relations: \["account"]` and verify `character.account?.id === player.account.id` | YES — two guard lines | Pass 1 |

| LED-004 | F-C11 | Auth / Session | CRITICAL | confirmed code bug | AUDIT\_AUTH\_ACCOUNT.md | `source/server/serverevents/Character.event.ts` | 148–150 | `character::create` calls `startCreatorFlow(player)` with no `player.account` check; unauthenticated player is teleported to creator preview dimension | Unauthenticated player enters creator dimension, which compounds LED-003 exploitation (AUTH-C02 in source audit) | Add `if (!player.account) return player.kick("Not authenticated.")` before `startCreatorFlow` | YES — one guard line | Pass 1 |

| LED-005 | F-H13 | Auth / Session | HIGH | confirmed security risk | AUDIT\_AUTH\_ACCOUNT.md | `source/server/serverevents/Auth.event.ts`, `source/server/auth/AccountSession.ts` | Auth.event.ts:41, AccountSession.ts:7–8 | `loginPlayer` handler does not check if `player.account` is already set; an authenticated player can call it again with different credentials to silently overwrite their session | Mid-session account hijacking; combined with LED-001 (known credentials), attacker with one credential set can take over an online admin's server presence | Add `if (player.account) return player.showNotify(...)` at start of loginPlayer handler; same check inside `enterGameWithAccount` | YES — one guard line at handler entry | Pass 1 |

| LED-006 | F-H14 | Auth / Session | HIGH | confirmed security risk | AUDIT\_AUTH\_ACCOUNT.md | `source/server/auth/DiscordOAuthServer.ts`, `source/server/serverevents/Auth.event.ts` | DiscordOAuthServer.ts:186–225, Auth.event.ts:78 | Discord OAuth callback does not check `player.account` before calling `enterGameWithAccount`; an authenticated player can start OAuth as a different (potentially admin) Discord-linked account and swap sessions | Privilege escalation path: if attacker controls a Discord account linked to an admin account, they can overwrite their session to gain admin level | In `auth::discordStart`: add `if (player.account) return ...`; in callback: add `if (target.account !== null) { closeOverlay(); return; }` | YES — two guard lines | Pass 1 |

| LED-007 | LED-AUTH-H01 (unlisted in F-table) | Auth / Session | HIGH | confirmed code bug | AUDIT\_AUTH\_ACCOUNT.md | `source/server/serverevents/Auth.event.ts` | 41–75 | No rate limiting on `loginPlayer`; no failed attempt counter; no lockout; bcrypt at 12 rounds ≈ 150–300 attempts/min per player | Brute-force attack against any known username; multiple simultaneous connections compound rate | Per-player failed attempt Map; clear on success or disconnect; lock 60s after 5 failures | YES | Pass 1 |

| LED-008 | F-H12 | Auth / Session | HIGH | confirmed code bug | AUDIT\_AUTH\_ACCOUNT.md | `source/server/auth/discordHttps.ts` | 8–39 | No `req.setTimeout()` on Discord HTTPS requests; if Discord accepts TCP but sends no data, the Promise never resolves; OAuth session hangs indefinitely | Player CEF overlay stuck with no recovery; server async handler suspended with no cleanup | Add `req.setTimeout(10000, () => req.destroy(new Error("Discord API request timed out")))` | YES — 3-line addition | Pass 1 |

| LED-009 | F-H15 | Auth / Session | HIGH | confirmed code bug | AUDIT\_AUTH\_ACCOUNT.md | `source/server/serverevents/Character.event.ts` | 116–127 | `creator::navigation` has no auth gate and no type check on `parsedName`; any player can fire `changeCamera` on any player in the creator; `"creator\_" + {}` produces `"creator\_\[object Object]"` sent to client | Any unauthenticated player can trigger camera events on active creator players; string concat accepts objects/numbers | Add `if (!player.account) return;` and `if (typeof parsedName !== "string" \\|\\| parsedName.length > 64) return;` | YES | Pass 1 |

| LED-010 | F-H02 | CEF / Client | HIGH | confirmed code bug | AUDIT\_FRONTEND\_CEF\_UI.md | `source/client/classes/Browser.class.ts` | 416–419 | `browser.execute()` template literal interpolates event name without `JSON.stringify`; a crafted event name injects arbitrary JS into the CEF browser context | Server-side or event-name-controlled JS injection into every connected client's Chromium overlay; `mp.trigger()` callable from injected code | Change template literal to `\\`window.callHandler(${JSON.stringify(event)}, ${argsString})\\`` | YES — single string change | Pass 1 |

| LED-011 | F-H03 | CEF / Client | HIGH | confirmed security risk | AUDIT\_FRONTEND\_CEF\_UI.md | `source/client/clientevents/Auth.event.ts` | 50–57 | Discord OAuth URL passed to `mp.browsers.new(url)` with only a truthy string check; compromised server packet can open any URL (`file:///`, `javascript:`, phishing domain) in Chromium overlay with full local privileges | Escalation from server compromise to arbitrary client-side code execution | Add `if (!url.startsWith("https://discord.com/api/oauth2/authorize")) return;` before creating browser | YES — one guard line | Pass 1 |

| LED-012 | F-C09 | CEF / Frontend | CRITICAL | confirmed security risk | AUDIT\_FRONTEND\_CEF\_UI.md | `frontend/src/pages/hud/Chat/Chat.tsx` | 182 | `dangerouslySetInnerHTML={{ \_\_html: timePrefix + el.html }}` — server-supplied `el.html` rendered with no sanitization; RAGE:MP CEF uses Chromium without sandbox | XSS: injected JS can call `mp.trigger()` and fire client-side RAGE:MP events; full browser-level code execution in game client | Replace with `DOMPurify.sanitize(el.html)` or render message as plain React text nodes (eliminates attack surface) | YES — import DOMPurify + wrap | Pass 1 |

| LED-013 | F-M11 | Auth / Session | MEDIUM | confirmed code bug | AUDIT\_AUTH\_ACCOUNT.md | `source/server/serverevents/Auth.event.ts` | 41 | No server-side input length validation on `username` or `password` before DB query and bcrypt; username > 32 chars causes TypeORM error / unhandled async rejection | Crashes DB query path; large password causes unnecessary memory allocation | Add `if (String(username).length > 32 \\|\\| String(password).length > 128) return player.showNotify(...)` | YES | Pass 1 |

| LED-014 | F-M09 | Auth / Session | MEDIUM | confirmed code bug | AUDIT\_AUTH\_ACCOUNT.md | `source/server/serverevents/Player.event.ts` | 244 | `parseInt(banData.lifttime)` produces `NaN` on null/malformed value; `Date.now() > NaN` is `false`; temporary bans with corrupt `lifttime` never auto-expire — become silently permanent | Players permanently banned with no recourse; no error surface for ops | `const liftMs = parseInt(banData.lifttime ?? ""); if (!isNaN(liftMs) \&\& hasDatePassedTimestamp(liftMs)) { delete ban; } else if (isNaN(liftMs)) { console.error(...); }` | YES | Pass 1 |

| LED-015 | F-H27 | Admin | HIGH | confirmed security risk | AUDIT\_ADMIN\_REPORTS.md | `source/server/admin/AdminPovCapture.service.ts` | 307–327 | `server::admin:pov:frameChunk` caps total chunks at 5,000 but has no byte limit per chunk; `pending.chunks\[index] = String(chunkRaw ?? "")` accepts any size | A monitored player can exhaust server memory with 5,000 × arbitrarily large chunk strings | Add `if (String(chunkRaw).length > 8000) return;` per chunk; add total assembled frame size cap (e.g. ≤ 4 MB) | YES | Pass 1 |

| LED-016 | F-H28 | Admin | HIGH | confirmed security risk | AUDIT\_ADMIN\_REPORTS.md | `source/server/serverevents/Admin.event.ts` | 929–982 | `hopoutsZoneEditorDelete` and `hopoutsZoneEditorDeleteMap` call no `auditLog()` before permanently deleting presets/zones/runtime config | Level-6 admin can silently delete all arena maps with no audit trail | Add `auditLog(...)` call at start of both destructive zone editor handlers | YES | Pass 1 |

| LED-017 | F-H29 | Anti-Cheat | HIGH | confirmed security risk | AUDIT\_ADMIN\_REPORTS.md | `source/server/admin/AdminAntiCheat.service.ts` | 175–181 | All AC flags and heartbeat strikes deleted on `playerQuit`; cheating player resets record by disconnecting | AC heuristics are session-only; patterns that should trigger investigation are invisible across sessions | Persist `flagHistory` and heartbeat strikes to DB keyed by account id; reload on connect | YES — DB persist | Pass 1 |

| LED-018 | F-M07 | Anti-Cheat | MEDIUM | confirmed code bug | AUDIT\_ADMIN\_REPORTS.md / AUDIT\_FINDINGS\_FULL.md | `source/server/admin/AdminAntiCheat.service.ts` | 62–65 | Heartbeat nonce uses `Math.random()` — not CSPRNG; format encodes player.id (public) + timestamp (predictable); V8 PRNG state could allow nonce prediction | A sophisticated cheating client could pre-compute challenge responses and pass heartbeat checks | Replace with `crypto.randomBytes(16).toString('hex')` | YES | Pass 1 |



\---



\### Fix Pass 2 — Combat safety (7 items)



| Ledger ID | Canonical ID | Subsystem | Sev | Confidence | Source audit file | Affected files | Lines | Problem | Why | Fix direction | Safe now | Pass |

|-----------|--------------|-----------|-----|------------|-------------------|--------------------|-------|---------|-----|---------------|----------|------|

| LED-019 | F-C01 | Combat | CRITICAL | needs runtime test | AUDIT\_DAMAGE\_COMBAT.md + AUDIT\_OF\_AUDITS\_WIKI\_RECHECK.md | `source/server/serverevents/DamageSync.event.ts` | 172 | `mp.players.at(victimId)` used with `target.remoteId`; wiki §3A dispute: `at()` may or may not be wrong for server-side remote IDs | If pool index ≠ remote ID in deployed build, hits target wrong player or silently drop | Add `atRemoteId` with fallback; confirm with 2-client test first — see AUDIT\_OF\_AUDITS\_WIKI\_RECHECK.md §3A | RUNTIME TEST FIRST before changing | Pass 2 / Runtime Test |

| LED-020 | F-C04 | Combat | CRITICAL | confirmed code bug | AUDIT\_DAMAGE\_COMBAT.md | `source/server/serverevents/DamageSync.event.ts` | 244, 261 | Warmup state falls through to uncapped freeroam damage block; all three `state === "active"` checks fail during warmup so full uncapped damage is applied | Players killed during warmup phase | Add `} else if (ffaMatch \\|\\| gunGameMatch \\|\\| hopoutsMatch) { return; }` before the freeroam else block | YES | Pass 2 |

| LED-021 | F-C07 | Combat | CRITICAL | confirmed code bug | AUDIT\_DAMAGE\_COMBAT.md | `source/server/serverevents/DamageSync.event.ts` | 170–173 | No alive/dead check on the shooter; `mp.players.exists()` returns true regardless of health state | Dead players can continue killing; kill credit goes to dead player; stats corrupted | Add `if (shooter.getVariable("alive") === false) return;` (or `shooter.health <= 0`) | YES | Pass 2 |

| LED-022 | F-C08 | Combat | CRITICAL | confirmed code bug | AUDIT\_DAMAGE\_COMBAT.md | `source/server/serverevents/DamageSync.event.ts`, `source/server/modules/combat/CombatIntegrity.ts` | 104–105, 72–76 | Unknown `weaponHash` falls back to `DEFAULT\_WEAPON\_BASE=28, DEFAULT\_MAX\_DISTANCE\_M=100m` instead of being rejected | Modified clients claim arbitrary weapon damage/range tables | Add `if (!weaponDamage\[weaponHash]) return;` as first hash check | YES | Pass 2 |

| LED-023 | F-H16 | Combat | HIGH | confirmed code bug | AUDIT\_DAMAGE\_COMBAT.md | `source/server/serverevents/DamageSync.event.ts`, `source/client/modules/DamageSync.module.ts` | DamageSync.event.ts:210 | Client-controlled bone string drives 1.5× headshot multiplier; console.warn at >90% ratio but no enforcement action | Modified clients claim "Head" every shot for perpetual 1.5× damage | Server-side enforcement: cap headshot ratio → remove multiplier after N suspicious events; at minimum log to admin panel (not just console) | NEEDS PRODUCT DECISION | Pass 2 |

| LED-024 | F-M36 | Combat | MEDIUM | confirmed code bug | AUDIT\_DAMAGE\_COMBAT.md | `source/server/serverevents/DamageSync.event.ts` | 194–197 | Team damage check `if (victimTeam \&\& shooterTeam \&\& victimTeam === shooterTeam) return` — if either team is `undefined` during join race, `\&\&` short-circuits and friendly fire is not blocked | Edge-case team damage during join-window race condition | Change to `if (!victimTeam \\|\\| !shooterTeam \\|\\| victimTeam === shooterTeam) return;` | YES | Pass 2 |

| LED-025 | F-M39 | Combat | MEDIUM | confirmed code bug | AUDIT\_DAMAGE\_COMBAT.md | `source/server/serverevents/DamageSync.event.ts` | 307–329 | `server:BotPedHit` handler skips all three CombatIntegrity checks (fire rate, duplicate hit, distance) | Bot kills farmable at unlimited rate; exploitable for XP/challenge rewards tied to bot kills | Add `validateFireRate`, `validateDuplicateHit`, `validateDistance` calls to BotPedHit handler | YES | Pass 2 |



\---



\### Fix Pass 3 — Performance / stability (9 items)



| Ledger ID | Canonical ID | Subsystem | Sev | Confidence | Source audit file | Affected files | Lines | Problem | Why | Fix direction | Safe now | Pass |

|-----------|--------------|-----------|-----|------------|-------------------|--------------------|-------|---------|-----|---------------|----------|------|

| LED-026 | F-C02 | Client perf | CRITICAL | confirmed code bug | AUDIT\_FINDINGS\_FULL.md | `source/client/classes/Camera.class.ts` | \~372 | `setInterval(() => Camera.rotateEntity(x), 0)` — 0 ms interval → JS event-loop spin; CPU maxed + heading desync | Server performance degradation on any client using camera rotation | Change to `setInterval(fn, 16)` (≈60fps cadence) | YES | Pass 3 |

| LED-027 | F-C03 | Client perf | CRITICAL | confirmed code bug | AUDIT\_FINDINGS\_FULL.md | `source/client/prototype/Player.prototype.ts` | \~97 | `setInterval(() => mp.game.ui.weaponWheelIgnoreSelection())` — missing interval arg defaults to 0ms; spin-lock when weapon wheel disable active | Same CPU impact as LED-026 | Add `100` ms interval argument | YES | Pass 3 |

| LED-028 | F-H08 | Client stability | HIGH | confirmed code bug | AUDIT\_FINDINGS\_FULL.md | `source/client/classes/Raycast.class.ts` | 21 | `setInterval(100ms)` in Raycast constructor has no `clearInterval` in any destroy path; fires for entire session | Memory/execution leak | Store interval ID; call `clearInterval` in destroy path | YES | Pass 3 |

| LED-029 | F-H22 | Client perf | HIGH | confirmed code bug | AUDIT\_FRONTEND\_CEF\_UI.md | `source/client/classes/Browser.class.ts` | 191 | `mp.events.add("render", this.onTick.bind(this))` in constructor; never removed in `emergencyReset`, `closePage`, or `playerQuit`; `applyGameplayControlBatch()` fires every frame | Per-frame control batch fires when no page open; wasted CPU | Store bound ref; call `mp.events.remove("render", this.\_onTick)` in teardown | YES | Pass 3 |

| LED-030 | F-H23 | Client perf | HIGH | confirmed code bug | AUDIT\_FRONTEND\_CEF\_UI.md | 35+ module files under `source/client/modules/` | various | All per-frame `mp.events.add("render", ...)` in module scope; never removed; 60 Hz for full session regardless of feature state | \~60.5M handler invocations per 8h session; dominant frame-time cost | Introduce `enable()`/`disable()` pair per module; register render only when feature active | YES (but broad) | Pass 3 |

| LED-031 | F-H26 | Client stability | HIGH | confirmed code bug | AUDIT\_FRONTEND\_CEF\_UI.md | `source/client/classes/Hud.class.ts` | 31, 36–40 | `clearIntervals()` on playerQuit clears three setIntervals but NOT the render event handler; `pushVitalsToCefEveryFrame` continues on every frame pushing to non-existent CEF page | Silent CPU waste + potential null-ref in dead CEF context | Add `mp.events.remove("render", this.\_vitalsTick)` inside `clearIntervals()` | YES | Pass 3 |

| LED-032 | F-H06 | Client stability | HIGH | confirmed code bug | AUDIT\_FINDINGS\_FULL.md | `source/client/classes/Camera.class.ts` | 291–298 | `destroyCamera` never removes entries from `this.list`; `isActive()` returns stale truthy for destroyed cameras | Logic using `isActive()` makes incorrect decisions after camera destruction | Call `this.list.delete(camId)` inside `destroyCamera` | YES | Pass 3 |

| LED-033 | F-H30 | Hopouts stability | HIGH | confirmed code bug | AUDIT\_HOPOUTS\_ZONE\_SPAWNS.md | `server/modes/hopouts/ArenaSpawn.validation.ts` | 60 | `preset.center ?? { x: preset.redSpawn.x, y: preset.redSpawn.y, z: zMed }` — if both `center` and `redSpawn` are null, throws `TypeError`; no `try/catch` | Malformed preset crashes server process | Add null guard: `if (!preset.center \&\& !preset.redSpawn) return false;` or validate preset schema on load | YES | Pass 3 |

| LED-034 | F-M18 | Hopouts stability | MEDIUM | confirmed code bug | AUDIT\_HOPOUTS\_ZONE\_SPAWNS.md | `server/modes/hopouts/ZoneSystem.ts` | 62, 110 | `stormDamageBank` entries for disconnected players never deleted on disconnect; old `player.id` orphaned since `stopZone` iterates current match player IDs only | Unbounded memory growth proportional to disconnect frequency over server lifetime | Add `stormDamageBank.delete(player.id)` in disconnect handler | YES | Pass 3 |



\---



\### Fix Pass 4 — Persistence / data integrity (8 items)



| Ledger ID | Canonical ID | Sev | Confidence | Source audit | Affected files | Lines | Problem | Why | Fix | Safe | Pass |

|-----------|--------------|-----|------------|--------------|----------------|-------|---------|-----|-----|------|------|

| LED-035 | F-C10 | CRITICAL | confirmed security risk | AUDIT\_ADMIN\_REPORTS.md | `source/server/admin/AdminAudit.service.ts` | 9–17 | Admin audit log in-memory ring buffer (2000 entries); cleared on every restart; rogue admin can restart to erase actions | Zero persistent accountability for admin actions | Persist entries to a DB table; keep ring buffer for UI only | YES | Pass 4 |

| LED-036 | F-C12 | CRITICAL | confirmed security risk | AUDIT\_ADMIN\_REPORTS.md | `source/server/report/Report.manager.ts` | 49–50 | Report system entirely in-memory; every report lost on crash or restart | Destroying reports by triggering a crash; players lose filing history | Persist `ReportEntry` to a DB table | YES | Pass 4 |

| LED-037 | F-H11 | HIGH | confirmed code bug | AUDIT\_AUTH\_ACCOUNT.md | `source/server/serverevents/Character.event.ts`, `source/server/serverevents/Auth.event.ts` | Character.event.ts:154–193, Auth.event.ts:106–160 | No TypeORM transactions on character creation or Discord account registration; crash between steps leaves orphaned rows | Characters/accounts in inconsistent state requiring manual DB intervention | Wrap each multi-step create path in a `QueryRunner` transaction with `commit`/`rollback` | YES | Pass 4 |

| LED-038 | F-H36 | HIGH | confirmed security risk | AUDIT\_FFA\_GUNFAME\_RANKED.MD | `source/server/modules/stats/StatsManager.ts` | 56–78 | `updateRankedMatchResult` has no DB-level idempotency key; in-memory `match.state === "match\_end"` guard is the only protection; lost on restart → double MMR application possible | Double MMR on ranked match after server restart mid-finalization | Add a `finalized: boolean` column to match result entity; check before applying delta | YES | Pass 4 |

| LED-039 | F-H33 | HIGH | confirmed security risk | AUDIT\_FFA\_GUNFAME\_RANKED.MD | `source/server/modes/ffa/FfaMatch.manager.ts`, `source/server/modes/gungame/GunGameMatch.manager.ts` | FfaMatch:282–306, GunGame:304–328 | Match-end stat persistence is fire-and-forget; partial DB failure leaves some players with stats and others without; no retry | Inconsistent stat states with no reconciliation | Wrap per-player stat block in a DB transaction; log per-player failure record for retry | YES | Pass 4 |

| LED-040 | F-H06 | HIGH | confirmed code bug | AUDIT\_LOADOUT\_CLOTHING\_VEHICLES.md | `source/server/classes/Vehicle.class.ts` | 512–549, 467–489 | `saveVehicle()` and `insertVehicle()` execute 15+ column updates with no QueryRunner transaction; partial update on connection drop leaves row corrupted | Vehicles in partially updated state with no rollback | Wrap in TypeORM `QueryRunner` transaction | YES | Pass 4 |

| LED-041 | F-C13 | CRITICAL | confirmed code bug | AUDIT\_FFA\_GUNFAME\_RANKED.MD | `source/server/modules/stats/StatsManager.ts`, `source/server/modules/stats/ProgressionManager.ts` | StatsManager:106–136, ProgressionManager:89–110 | All stat increment functions use load-modify-save (`read row → row.field++ → repo.save`); concurrent calls for same player (kills + match-end XP) lose data permanently | Kill counts, XP, MMR, challenge progress silently lost under normal match-end concurrency | Replace with atomic SQL increments: `UPDATE ... SET kills = kills + 1 WHERE "playerId" = $1` | YES | Pass 4 |

| LED-042 | F-M26 | MEDIUM | confirmed code bug | AUDIT\_FFA\_GUNFAME\_RANKED.MD | `source/server/modules/stats/ChallengeManager.ts` | 112–155 | `incrementChallengeProgress` uses same load-modify-save pattern as LED-041; concurrent kills lose one unit of challenge progress | Challenge targets delayed by 1 per race event; challenge may never complete if races are frequent | Same atomic increment fix as LED-041 | YES | Pass 4 |



\---



\### Fix Pass 5 — Gameplay integrity (12 items)



| Ledger ID | Canonical ID | Sev | Confidence | Source audit | Affected files | Lines | Problem | Fix | Pass |

|-----------|--------------|-----|------------|--------------|----------------|-------|---------|-----|------|

| LED-043 | F-C14 | CRITICAL | confirmed code bug | AUDIT\_LOADOUT\_CLOTHING\_VEHICLES.md | `server/arena/WeaponPresets.service.ts` | equipToFreeroam, equipForEdit, savePreset handlers | `WEAPON\_REGISTRY.enabled` never consulted; RPG / grenade launcher / minigun grantable via valid carry-group check | Enforce `WEAPON\_REGISTRY.enabled` check in all three handlers | Pass 5 |

| LED-044 | F-H17 | HIGH | confirmed code bug | AUDIT\_FINDINGS\_FULL.md | `server/modes/hopouts/ArenaMatch.manager.ts` | 1102–1107, 1474 | Reconnect restores HP to 200 and armor to 100 unconditionally; deliberate disconnect-reconnect resets full HP mid-round | Restore pre-disconnect HP/armor snapshot stored in `MatchPlayer` | Pass 5 |

| LED-045 | F-H18 | HIGH | confirmed code bug | AUDIT\_FINDINGS\_FULL.md | `server/modes/hopouts/ArenaMatch.manager.ts` | 1560–1603 | Disconnect mid-round does not increment `deaths`; players preserve K/D by disconnecting before death lands | Flag disconnect-as-death if player was alive when disconnecting | Pass 5 |

| LED-046 | F-H31 | HIGH | confirmed code bug | AUDIT\_HOPOUTS\_ZONE\_SPAWNS.md | `server/modes/hopouts/ArenaMatch.manager.ts` | 1590–1597 | Stale disconnect grace `setTimeout` (15s) fires during Round N+1; both guards pass because match object is live; `checkRoundEnd` ends Round N+1 prematurely in opponent's favor | Root cause = LED-047; fix by capturing round number at setTimeout creation and comparing in callback | Pass 5 |

| LED-047 | F-H32 | HIGH | confirmed code bug | AUDIT\_HOPOUTS\_ZONE\_SPAWNS.md | `server/modes/hopouts/ArenaMatch.manager.ts` | 1198–1199 | `beginRound` resets `alive=true` but not `disconnected` or `roundPresenceDeadline`; stale flags from prior disconnect persist into new round | Add `p.disconnected = false; p.roundPresenceDeadline = undefined;` in `beginRound` forEach loops | Pass 5 |

| LED-048 | F-H19 | HIGH | confirmed security risk | AUDIT\_FINDINGS\_FULL.md | `server/modes/ffa/FfaMatch.manager.ts` | 238–280 | No protection against coordinated intentional kill-farming between two accounts in FFA | Rate-based kill pair detection; flag repeated same-pair kills; admin alert | Pass 5 |

| LED-049 | F-M01 | MEDIUM | confirmed code bug | AUDIT\_FINDINGS\_FULL.md | `server/modes/hopouts/ArenaMatch.manager.ts` | 527–548, 1291–1302 | `completeRound` can be called simultaneously from zone kill path and tick path; double score increment possible | Add `roundCompleted` idempotency flag; set before any state mutation | Pass 5 |

| LED-050 | F-M20 | MEDIUM | confirmed code bug | AUDIT\_HOPOUTS\_ZONE\_SPAWNS.md | `server/modes/hopouts/ArenaMatch.manager.ts` | 1469–1470 | Reconnecting player always gets full `countPerRound` medkits/plates regardless of pre-disconnect usage | Store `medkitsUsed`/`platesUsed` on `MatchPlayer`; restore `max(0, perRound - used)` | Pass 5 |

| LED-051 | F-M25 | MEDIUM | confirmed code bug | AUDIT\_FFA\_GUNFAME\_RANKED.MD | `server/modes/ffa/FfaMatch.manager.ts`, `server/modes/gungame/GunGameMatch.manager.ts` | FfaMatch:160–162, GunGame:171–173 | OOB grace timer reset on re-entry; player can indefinitely reset 8s grace by touching zone boundary every \~7s | Accumulate total OOB time; only reset bank on legitimate zone re-entry with 1s hysteresis | Pass 5 |

| LED-052 | F-M06 | MEDIUM | confirmed code bug | AUDIT\_FINDINGS\_FULL.md | `server/modes/gungame/GunGameMatch.manager.ts`, `server/serverevents/Death.event.ts` | GunGame:266, Death.event.ts:37 | Simultaneous `playerDeath` + `server:PlayerHit` can both call `handleGunGameDeath` before guard fires; potential double tier advance | Add tier-advance debounce flag per player; clear on next round | Pass 5 |

| LED-053 | RANK-02 = F-H36 | (covered in LED-038) | — | — | — | — | Already covered by LED-038 | — | Pass 4 |

| LED-054 | F-M19 | MEDIUM | confirmed code bug | AUDIT\_HOPOUTS\_ZONE\_SPAWNS.md | `server/modes/hopouts/ZoneSystem.ts` | 111–113 | `stopZone` else branch (match lookup returns null) calls `outOfBoundsStart.clear()` — module-level map shared across all concurrent matches; wipes OOB tracking for all active matches | Change to iterate and delete only entries belonging to the stopped match's dimension players | Pass 5 |



\---



\### Fix Pass 6 — Loadout / clothing / vehicle validation (10 items)



| Ledger ID | Canonical ID | Sev | Confidence | Source audit | Affected files | Lines | Problem | Fix | Pass |

|-----------|--------------|-----|------------|--------------|----------------|-------|---------|-----|------|

| LED-055 | F-H39 | HIGH | confirmed code bug | AUDIT\_LOADOUT\_CLOTHING\_VEHICLES.md | `server/serverevents/Wardrobe.event.ts` | 110–121 | `isValidClothesSlot` checks `>= 0` only; no upper bound; `drawable: 2147483647` accepted and stored in JSONB | Add per-slot upper bounds from `clothesLimits.ts` | Pass 6 |

| LED-056 | F-H40 | HIGH | confirmed code bug | AUDIT\_LOADOUT\_CLOTHING\_VEHICLES.md | `server/serverevents/Wardrobe.event.ts`, `shared/json/wardrobeBlockedDrawables.json` | saveInline handler | `wardrobeBlockedDrawables.json` only consulted by client UI picker; `saveInline` server handler never checks it | Import blocked list server-side; reject in `saveInline` handler | Pass 6 |

| LED-057 | F-H41 | HIGH | confirmed code bug | AUDIT\_LOADOUT\_CLOTHING\_VEHICLES.md | `server/serverevents/Wardrobe.event.ts` | saveClothesAndSync | No gender/model validation; female-only drawables applied to male character and vice versa | Validate clothing drawable against `character.gender` / ped model before saving | Pass 6 |

| LED-058 | F-H37 | HIGH | confirmed code bug | AUDIT\_LOADOUT\_CLOTHING\_VEHICLES.md | `server/arena/WeaponPresets.service.ts` | 267–271, 69–71 | When weapon has no attachment data entry, fallback code path accepts any component hash from client | Add hard rejection when `attachmentData === undefined`; do not fall back to unvalidated | Pass 6 |

| LED-059 | F-H38 | HIGH | confirmed code bug | AUDIT\_LOADOUT\_CLOTHING\_VEHICLES.md | `server/arena/WeaponPresets.service.ts` | savePreset handler | `savePreset` has no competitive-context guard (unlike `equipToFreeroam`); match-granted weapon components saveable to freeroam preset | Add same competitive context check as `equipToFreeroam` | Pass 6 |

| LED-060 | LED-LCV-C2 | CRITICAL | needs RAGE:MP doc reconciliation | AUDIT\_LOADOUT\_CLOTHING\_VEHICLES.md | `server/prototype/WeaponComponentTintSync.prototype.ts` | setWeaponTint handler | Tint index accepted without range check; GTA V valid range 0–7 for most weapons; out-of-range values persisted and broadcast | Add `if (tintIndex < 0 \\|\\| tintIndex > 7) return;` — verify exact range per weapon on live RAGE:MP docs first | Pass 6 |

| LED-061 | LED-LCV-C3 | CRITICAL | confirmed code bug | AUDIT\_LOADOUT\_CLOTHING\_VEHICLES.md | `server/serverevents/Vehicle.event.ts` | spawnVehicleFromWizard | No per-player vehicle spawn limit in freeroam; `vehiclePool` unbounded; unlimited RAM consumption | Add cap of 3–5 vehicles per player in freeroam | Pass 6 |

| LED-062 | F-L23 | HIGH | confirmed security risk | AUDIT\_LOADOUT\_CLOTHING\_VEHICLES.md | `server/arena/WeaponPresets.service.ts` | applyWeaponPresets | Preset component hashes from DB applied on spawn without re-filtering against current attachment data | Add filter pass on load using current attachment data; log/skip unknown hashes | Pass 6 |

| LED-063 | F-L20 | MEDIUM | confirmed security risk | AUDIT\_LOADOUT\_CLOTHING\_VEHICLES.md | `server/serverevents/Wardrobe.event.ts` | saveInline handler | No per-player cooldown on clothing saves; tight loop generates DB writes at loop rate | Add 500ms per-player cooldown Map; reject calls within window | Pass 6 |

| LED-064 | F-M03 (audit CEF) | MEDIUM | confirmed code bug | AUDIT\_FINDINGS\_FULL.md | `source/client/classes/Browser.class.ts` | emergencyReset | Blur state not cleared on `emergencyReset`; world remains blurred indefinitely if open page had requested blur | Add `mp.game.graphics.transitionFromBlurred(0)` at start of `emergencyReset()` | Pass 6 |



\---



\### Fix Pass 7 — UI / UX polish (10 items)



| Ledger ID | Canonical ID | Sev | Confidence | Source audit | Affected files | Lines | Problem | Fix | Pass |

|-----------|--------------|-----|------------|--------------|----------------|-------|---------|-----|------|

| LED-065 | F-H01 | HIGH | needs RAGE:MP doc reconciliation | AUDIT\_FRONTEND\_CEF\_UI.md + AUDIT\_OF\_AUDITS\_WIKI\_RECHECK.md | `source/client/classes/Browser.class.ts` | 341, 378 | `mp.gui.cursor.show(showCursor, showCursor)` — wiki §3B says params are `(freezeControls, visibility)` not `(visible, lockedAtCenter)`; tying both to same bool may break UI cursor usability | Change to `mp.gui.cursor.show(showCursor, false)` — runtime test to confirm whether cursor tracks correctly | Pass 7 |

| LED-066 | F-H25 | HIGH | confirmed code bug | AUDIT\_FRONTEND\_CEF\_UI.md | `frontend/src/pages/hud/TacticalCompass.tsx` | TICK\_COUNT=4608 | 4,608 DOM nodes for compass tape; CSS transform composites full subtree every frame; dominant frame-time on low-end hardware | Replace with canvas/SVG loop approach; only \~36 ticks needed in visible window | Pass 7 |

| LED-067 | F-H24 | HIGH | confirmed security risk | AUDIT\_FRONTEND\_CEF\_UI.md | `frontend/src/pages/hud/HUD/ArenaHud.tsx` | 84 | Hardcoded `https://i.imgur.com/k6lP09r.jpg` in production build; external CDN dependency; debug state exposure in bundle | Replace with local asset or gate entire branch behind `import.meta.env.DEV` | Pass 7 |

| LED-068 | F-H20 | HIGH | confirmed code bug | AUDIT\_FRONTEND\_CEF\_UI.md | `frontend/src/App.tsx` | 55–67 | `EventManager.stopAddingHandler()` is a debug-log no-op; handlers accumulate on every remount | Replace with `EventManager.removeHandler()` in cleanup return | Pass 7 |

| LED-069 | F-H21 | HIGH | confirmed code bug | AUDIT\_FRONTEND\_CEF\_UI.md | All MobX store files | createEvents() | Every store's `createEvents()` ends with `stopAddingHandler()` no-op; no handlers ever removed | Ensure `createEvents()` called once per store, document invariant; or add `destroyEvents()` with `removeHandler()` calls | Pass 7 |

| LED-070 | F-M30 | MEDIUM | confirmed code bug | AUDIT\_FINDINGS\_FULL.md | `frontend/src/stores/Chat.store.ts` | \~63 | `chatStore.messages = \[]` directly mutates MobX observable outside an action; throws invariant error in `enforceActions: "always"` mode | Wrap in `runInAction(() => { this.messages = \[]; })` | Pass 7 |

| LED-071 | F-M31 | MEDIUM | confirmed code bug | AUDIT\_FINDINGS\_FULL.md | `frontend/src/pages/hud/HUD/ArenaHud.tsx` | 74 | Returns `null` when both `match` and `matchEnd` are null; blank screen with no loading state | Add a loading/transition placeholder | Pass 7 |

| LED-072 | F-M34 | MEDIUM | confirmed code bug | AUDIT\_FINDINGS\_FULL.md | `frontend/src/stores/Arena.store.ts` | lobby/vitals/minimapData fields | Stale data from previous match visible at start of next match | Reset `lobby`, `vitals`, `minimapData` in `matchEnd` / `leftMatch` handlers | Pass 7 |

| LED-073 | F-M32 | MEDIUM | confirmed code bug | AUDIT\_FINDINGS\_FULL.md | `frontend/src/pages/admin/AdminPanel.tsx` | 699–724 | Raw GSAP tweens in 4 `useEffect` blocks with no cleanup; animate on detached DOM after fast dismiss | Return `tween.kill()` cleanup from each useEffect | Pass 7 |

| LED-074 | F-M33 | MEDIUM | needs runtime test | AUDIT\_FINDINGS\_FULL.md | `frontend/src/pages/Report.tsx`, `frontend/src/pages/admin/AdminPanel.tsx` | 1346, 886 | `window.prompt()` used in staff/admin actions; blocking dialog; behavior in RAGE:MP CEF undefined; may freeze game thread | Replace with custom modal/confirm overlay component | Pass 7 |



\---



\### Runtime Test Only / Do Not Touch Yet (8 items)



| Ledger ID | Canonical ID | Sev | Confidence | Source audit | Why deferred |

|-----------|--------------|-----|------------|--------------|--------------|

| LED-075 | F-C01 (alt) | CRITICAL | needs runtime test | AUDIT\_OF\_AUDITS\_WIKI\_RECHECK.md §3A | Wiki dispute: `mp.players.at(victimId)` vs `atRemoteId`; run 2-client damage test before changing; fix direction depends on outcome |

| LED-076 | F-H07 | HIGH | needs runtime test | AUDIT\_FINDINGS\_FULL.md | Constructor calls two experimental RAGE:MP APIs under `@ts-ignore`; needs live server to confirm if APIs exist in deployed build |

| LED-077 | F-H09 | HIGH | needs runtime test | AUDIT\_FINDINGS\_FULL.md | `getGroundZFor3dCoord` undefined/0 in interiors — teleport to Z=1; needs live interior test to confirm impact |

| LED-078 | F-M02 | MEDIUM | needs runtime test | AUDIT\_FINDINGS\_FULL.md | Zone boundary checked against client-reported position; position spoofing risk needs live latency/spoof test |

| LED-079 | F-M40 | MEDIUM | needs runtime test | AUDIT\_DAMAGE\_COMBAT.md | `getPedById` fallback pool-index vs remote-ID ambiguity depends on whether `ped.id` is pool index or remote ID in deployed RAGE:MP build |

| LED-080 | F-M24 | MEDIUM | needs runtime test | AUDIT\_FFA\_GUNFAME\_RANKED.MD | Queue TOCTOU window: `addPlayers` is synchronous; risk only if callers await between check and act; needs trace |

| LED-081 | F-M28 | MEDIUM | needs runtime test | AUDIT\_FINDINGS\_FULL.md | Weapon component/tint sync stream-in race; base-36 decode malformed entries silently discarded; needs multi-client streaming test |

| LED-082 | LED-LCV-M1 | MEDIUM | needs RAGE:MP doc reconciliation | AUDIT\_LOADOUT\_CLOTHING\_VEHICLES.md | Vehicle `setTuningMod` `modValue` upper bound depends on per-mod-index valid ranges not in wiki; needs RAGE:MP doc check |



\---



\## FIX\_PASS\_1\_SCOPE.md — content summary



This file will contain only LED-001 through LED-018 (Fix Pass 1 items), each with:

\- Ledger ID + canonical ID

\- One-sentence problem statement

\- Exact file(s) and line(s)

\- Exact code to add/change (or config change instruction)

\- Acceptance test (one-liner)

\- Explicit non-scope statement per item (no API behavior changes, no gameplay changes)



Items explicitly excluded from Pass 1 (with reason):

\- F-C01 (LED-019): RAGE:MP API disputed — runtime test required first

\- F-C04, F-C07, F-C08 (LED-020–022): combat gameplay — Pass 2

\- F-C02, F-C03 (LED-026–027): client-side CPU (setInterval 0ms) — Pass 3

\- F-C10, F-C12 (LED-035–036): DB persistence — Pass 4

\- F-C13 (LED-041): stats race — Pass 4

\- Any loadout/wardrobe items: Pass 6

\- Any UI/UX items: Pass 7



\---



\## Verification plan (post-implementation)



1\. Pass 1 security items: run runtime test checklist items #1–8 from AUDIT\_AUTH\_ACCOUNT.md

2\. Pass 1 auth items: confirm XSS test #21 from AUDIT\_FINDINGS\_FULL.md §8

3\. Confirm `.env` removed from git index: `git ls-files --cached | grep .env` returns empty

4\. Confirm `allow-cef-debugging: false` in both conf files

5\. Confirm `character::select` with foreign char ID returns kick (test #13 from AUDIT\_FINDINGS\_FULL.md §8)

6\. Confirm `loginPlayer` rate limit (test #4 from §8)

7\. Confirm `character::create` unauthenticated returns kick (test #2 from §8)



