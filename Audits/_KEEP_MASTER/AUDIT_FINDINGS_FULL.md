# AUDIT FINDINGS — FULL MERGED TABLE
## Havoc Arena RAGE:MP Server

**Date compiled:** 2026-04-25
**Source audits:** AUDIT_REPORT_STAGE1 · AUDIT_FINDINGS_STAGE1 · AUDIT_DAMAGE_COMBAT · AUDIT_AUTH_ACCOUNT · AUDIT_ADMIN_REPORTS · AUDIT_HOPOUTS_ZONE_SPAWNS · AUDIT_FFA_GUNGAME_RANKED · AUDIT_FRONTEND_CEF_UI · AUDIT_LOADOUT_CLOTHING_VEHICLES
**Companion report:** AUDIT_REPORT_FULL.md (narrative, fix list, QA checklist, UI/UX summary, gameplay integrity summary)

> **Errata (2026-04-25):** See **`AUDIT_OF_AUDITS_WIKI_RECHECK.md`** for live-wiki review of RAGE:MP API rows (e.g. **F-C01**, **F-H01**, overlay docs). Full-folder digest and **security / stability / gameplay / look** priority pillars are in §§7–9 of that file. Deprioritize or rewrite wiki-dependent rows before implementation.

---

## Status Legend

| Tag | Meaning |
|---|---|
| `VERIFIED CORRECT` | Code is unambiguously correct; confirmed regardless of runtime behavior |
| `HIGH-CONFIDENCE BUG` | Code logic is definitively broken by static analysis alone |
| `HIGH-CONFIDENCE RISK` | Security or data integrity risk confirmed by code; not mitigated anywhere |
| `PLAUSIBLE RISK / NEEDS RUNTIME TEST` | Risk depends on RAGE:MP runtime behavior not verifiable without live server |
| `UNVERIFIED AGAINST LIVE DOCS` | Behavior depends on live RAGE:MP API; wiki returned HTTP 403 during audit |
| `ENGINE LIMITATION` | GTA V / RAGE:MP fundamental constraint; not fixable in application code |
| `DESIGN CHOICE` | Intentional behavior; noted for operator awareness only |

---

## Section 1 — Critical Findings (14)

| Canonical ID | Source IDs | File : Line | Title | Status |
|---|---|---|---|---|
| **F-C01** | C01, DC-C01, CRIT-01 | `DamageSync.event.ts:172` | `mp.players.at(victimId)` used with remoteId — pool index ≠ remote ID; damage hits wrong player or is silently dropped; entire combat system broken | `HIGH-CONFIDENCE BUG` |
| **F-C02** | C02 | `Camera.class.ts:372` | `setInterval(() => Camera.rotateEntity(x), 0)` — zero-ms interval fires at maximum JS event-loop speed; CPU spin-lock; heading desync | `HIGH-CONFIDENCE BUG` |
| **F-C03** | C03 | `Player.prototype.ts:97` | `setInterval(() => mp.game.ui.weaponWheelIgnoreSelection())` — missing interval arg defaults to 0 ms; CPU spin-lock whenever weapon wheel disable is active | `HIGH-CONFIDENCE BUG` |
| **F-C04** | C04, DC-C04 | `DamageSync.event.ts:244,261` | Warmup godmode bypass: when `match.state !== "active"` all three mode checks fail; execution falls to freeroam `else` block which applies full uncapped damage; players can be killed during warmup | `HIGH-CONFIDENCE BUG` |
| **F-C05** | C05, AUTH-C01 | `Character.event.ts:132–144` | `character::select` handler fetches character by raw DB `id` with no `player.account` check and no ownership check; any player (including unauthenticated) can spawn as any character in the database | `HIGH-CONFIDENCE BUG` |
| **F-C06** | C06, ADMIN-C01 | `gamemode/.env`, `ragemp-server/.env` | Plaintext `DB_PASS=Headshot123`, `DB_BETA_PASSWORD=Headshot123`, and `DISCORD_CLIENT_SECRET=38a5hJt77ZO8dW1QyQGC_LECcbXVVUx7` committed to repository backup; anyone with access to the backup has full DB and Discord OAuth credentials | `HIGH-CONFIDENCE RISK` |
| **F-C07** | C07, DC-C07 | `DamageSync.event.ts:170–173` | No alive/dead check on the shooter; `mp.players.exists()` returns true for live-object players regardless of health state; dead players can continue sending `server:PlayerHit` events and deal damage with kill credit | `HIGH-CONFIDENCE BUG` |
| **F-C08** | C08, DC-C08 | `DamageSync.event.ts:104–105`; `CombatIntegrity.ts:72–76` | Client-supplied `weaponHash` is not validated against any whitelist; unknown hashes fall back to `DEFAULT_WEAPON_BASE=28`, `DEFAULT_MAX_DISTANCE_M=100m` instead of being rejected; modified client can claim any weapon's damage/range table | `HIGH-CONFIDENCE BUG` |
| **F-C09** | C09, CEF-C01 | `Chat.tsx:182` | `dangerouslySetInnerHTML={{ __html: timePrefix + el.html }}` — `el.html` is server-supplied content with no sanitization at any layer; full XSS vector; RAGE:MP CEF runs Chromium without sandbox; injected JS can call `mp.trigger()` | `HIGH-CONFIDENCE RISK` |
| **F-C10** | C10, ADMIN-C02 | `AdminAudit.service.ts:1–9` | Admin audit log stored in 2,000-entry in-memory ring buffer only; lost on every server restart; buffer rolls over under high activity; rogue admin can take destructive actions then restart to erase the trail | `HIGH-CONFIDENCE RISK` |
| **F-C11** | H13, AUTH-C02 | `Character.event.ts:148–150` | `character::create` handler calls `startCreatorFlow(player)` with no `player.account` check; unauthenticated player is teleported to a preview dimension and receives creator UI; compounds AUTH-C01 exploitation path | `HIGH-CONFIDENCE BUG` |
| **F-C12** | ADMIN-C03 | `Report.manager.ts:49–50` | Report system entirely in-memory (`const reports: ReportEntry[] = []`); every report — subject, message, chat history, claim/close audit trail — is lost on server crash or restart; bad actor with server restart access destroys evidence | `HIGH-CONFIDENCE RISK` |
| **F-C13** | CRIT-02, M12 | `StatsManager.ts:106–136`; `ProgressionManager.ts:89–110` | All stat increment functions use load-modify-save (`read row` → `row.field++` → `repo.save(row)`) without atomic DB increments; under any concurrent call for the same player (normal at match end: per-kill XP + match-end XP), the second write overwrites the first and data is permanently lost; affects kills, deaths, wins, losses, XP, MMR, challenge progress | `HIGH-CONFIDENCE BUG` |
| **F-C14** | LCV-C1, H18 | `WeaponPresets.service.ts` (`equipToFreeroam`, `equipForEdit`, `savePreset`) | `WEAPON_REGISTRY.enabled` flag is never consulted in any of the three weapon-grant handlers; only guard is the carry-group check; weapons like RPG, grenade launcher, and minigun that return `"primary"` or `"sidearm"` are granted unconditionally | `HIGH-CONFIDENCE BUG` |

---

## Section 2 — High Findings (41)

| Canonical ID | Source IDs | File : Line | Title | Status |
|---|---|---|---|---|
| **F-H01** | H01, CEF-H02 | `Browser.class.ts:341,378` | `mp.gui.cursor.show(showCursor, showCursor)` — second param `lockedAtCenter` receives same value as `visible`; when `showCursor=true` cursor is locked to screen center; all UI clicks register at viewport center; menus non-functional | `HIGH-CONFIDENCE BUG` (UNVERIFIED AGAINST LIVE DOCS — based on known API signature) |
| **F-H02** | H02, CEF-H01 | `Browser.class.ts:416–419` | `browser.execute("window.callHandler(\"${event}\", …)")` — event name string-interpolated without `JSON.stringify`; a crafted server-sent event name injects arbitrary JS into the CEF browser context | `HIGH-CONFIDENCE BUG` |
| **F-H03** | H03, AUTH-H06, CEF-M04 | `Auth.event.ts (client):56` | Discord OAuth URL from server is passed directly to `mp.browsers.new(url)` with no scheme/host validation; a compromised server packet can open any URL (`file:///`, `javascript:`, phishing domain) in the player's Chromium overlay | `HIGH-CONFIDENCE RISK` |
| **F-H04** | H04, ADMIN-H04 | `gamemode/conf.json:line 6`, `ragemp-server/conf.json:line 6` | `"allow-cef-debugging": true` in both conf files; Chromium DevTools protocol exposed; players can inspect JS, manipulate MobX stores, read CEF event payloads, and inject `mp.trigger()` calls in-game | `HIGH-CONFIDENCE RISK` |
| **F-H05** | H05 | `Camera.class.ts:217–219` | `resolution.y` assigned to a variable named `width` — screen height used as screen width in camera rotation direction threshold; rotation direction breaks on all non-square (i.e., all) screen resolutions | `HIGH-CONFIDENCE BUG` |
| **F-H06** | H06 | `Camera.class.ts:291–298` | `destroyCamera` never removes entries from `this.list`; `isActive()` returns stale truthy results for destroyed cameras | `HIGH-CONFIDENCE BUG` |
| **F-H07** | H07 | `Raycast.class.ts:23–27` | Constructor calls two undocumented/experimental RAGE:MP APIs under `@ts-ignore` with no `try/catch`; if APIs are absent in deployed RAGE:MP version, entire client crashes on startup | `PLAUSIBLE RISK / NEEDS RUNTIME TEST` |
| **F-H08** | H08 | `Raycast.class.ts:21` | `setInterval(100ms)` started in constructor with no `clearInterval` in any destroy path; fires indefinitely for the entire player session | `HIGH-CONFIDENCE BUG` |
| **F-H09** | H09 | `Player.prototype.ts:109` | `getGroundZFor3dCoord` can return `undefined` or `0` in interiors or unloaded terrain; no null check; player can be teleported to Z=1 (underground) | `PLAUSIBLE RISK / NEEDS RUNTIME TEST` |
| **F-H10** | H10 | `Admin.commands.ts:670–678` | `/ban` command does not save `rsgId` to the ban record; hardware/Social-Club-ID ban is always empty; bans bypassable with IP+VPN change plus hardware serial spoof | `HIGH-CONFIDENCE BUG` |
| **F-H11** | H11, AUTH-M01 | `Character.event.ts:154–193`; `Auth.event.ts:106–160` | No TypeORM transactions on character creation or Discord account registration; server crash between steps leaves orphaned character rows (character in DB, player never spawned) or orphaned account rows | `HIGH-CONFIDENCE RISK` |
| **F-H12** | H12, AUTH-H03 | `discordHttps.ts:8–39` | No timeout on Discord HTTPS outbound requests; if Discord API accepts the TCP connection but sends no data the Promise never resolves; player's OAuth session hangs indefinitely | `HIGH-CONFIDENCE BUG` |
| **F-H13** | AUTH-H02, M11 | `Auth.event.ts:41`; `AccountSession.ts:7–8` | `loginPlayer` has no "already logged in" guard; an authenticated player can call `loginPlayer` a second time with different credentials to silently replace their session; combined with F-C06, enables mid-session account hijacking | `HIGH-CONFIDENCE RISK` |
| **F-H14** | AUTH-H04 | `DiscordOAuthServer.ts:186–225`; `Auth.event.ts:78` | Discord OAuth callback does not check `player.account` before calling `enterGameWithAccount`; an authenticated player can start OAuth as a different (potentially admin) account and swap sessions silently; privilege escalation path | `HIGH-CONFIDENCE RISK` |
| **F-H15** | AUTH-H05 | `Character.event.ts:116–127` | `creator::navigation` handler has no auth gate and no type check on `parsedName`; any player can fire `changeCamera` on any player in the creator; `"creator_" + {}` = `"creator_[object Object]"` sent to client | `HIGH-CONFIDENCE BUG` |
| **F-H16** | H14, DC-H14 | `DamageSync.event.ts:210`; `DamageSync.module.ts:88` | `targetBone` string is client-controlled; a modified client always sends `"Head"` for 1.5× headshot multiplier on every shot; `CombatIntegrity` headshot ratio logger fires `console.warn` at >90% ratio but takes no enforcement action | `HIGH-CONFIDENCE BUG` |
| **F-H17** | H15 | `ArenaMatch.manager.ts:1102–1107,1474` | Players who disconnect and reconnect during a round have health set to 200 and armor to 100 unconditionally; deliberate disconnect-reconnect restores full HP mid-round | `HIGH-CONFIDENCE BUG` |
| **F-H18** | H16 | `ArenaMatch.manager.ts:1560–1603` | Disconnecting mid-round does not increment `deaths`; players can disconnect to avoid death penalty and preserve K/D ratio | `HIGH-CONFIDENCE BUG` |
| **F-H19** | H17 | `FfaMatch.manager.ts:238–280` | No protection against coordinated intentional deaths between two accounts; FFA kill farming is structurally undetected | `HIGH-CONFIDENCE RISK` |
| **F-H20** | H21, CEF-C02 | `App.tsx:55–67` | `EventManager.stopAddingHandler()` is a debug-log method — it does NOT remove handlers; `system:setPage` and `notify:show` handlers accumulate on every component remount | `HIGH-CONFIDENCE BUG` |
| **F-H21** | CEF-C03 | All MobX stores | Every `createEvents()` call ends with `EventManager.stopAddingHandler()` which is a no-op cleanup; no store handler is ever removed; applies to `Chat.store`, `Hud.store`, `Player.store`, `PlayerList.store`, `Friends.store`, `GunGame.store`, `AdminSpectate.store`, `CharCreator.store`, `Nativemenu.store`, `Wardrobe.store` | `HIGH-CONFIDENCE BUG` |
| **F-H22** | CEF-C04 | `Browser.class.ts:191` | `mp.events.add("render", this.onTick.bind(this))` in constructor with no removal in `emergencyReset()`, `closePage()`, or `playerQuit`; `applyGameplayControlBatch()` fires on every rendered frame for entire session | `HIGH-CONFIDENCE BUG` |
| **F-H23** | CEF-H03 | 35+ module files | All per-frame `mp.events.add("render", …)` calls across 35+ client modules are module-scope and never removed; fire at 60 Hz for full session regardless of feature state; estimated ~60.5 million invocations per 8-hour session | `HIGH-CONFIDENCE BUG` |
| **F-H24** | CEF-H04 | `ArenaHud.tsx:84` | Hardcoded `https://i.imgur.com/k6lP09r.jpg` URL in production build; external CDN dependency; reveals debug simulation state in bundle; broken behind corporate NAT/firewall | `HIGH-CONFIDENCE RISK` |
| **F-H25** | CEF-H05 | `TacticalCompass.tsx` | `TICK_COUNT = 4608` DOM nodes rendered for compass tape; CSS `transform` composites this subtree every frame; dominant client-side frame-time cost on low-end hardware | `HIGH-CONFIDENCE BUG` |
| **F-H26** | CEF-H06 | `Hud.class.ts:31,36–40` | `mp.events.add("render", this.pushVitalsToCefEveryFrame.bind(this))` in constructor; `clearIntervals()` on `playerQuit` clears the three `setInterval` calls but does not remove the render event; continues pushing vitals to a non-existent CEF page | `HIGH-CONFIDENCE BUG` |
| **F-H27** | ADMIN-H01 | `AdminPovCapture.service.ts:307–327` | `server::admin:pov:frameChunk` handler caps total chunk count at 5,000 but places no limit on individual chunk byte size; `pending.chunks[index] = String(chunkRaw ?? "")` — a monitored player can exhaust server memory with oversized chunk strings | `HIGH-CONFIDENCE RISK` |
| **F-H28** | ADMIN-H02 | `Admin.event.ts:929–982` | `hopoutsZoneEditorDelete` and `hopoutsZoneEditorDeleteMap` permanently delete presets, all zones, and all runtime config without any `auditLog()` call; a level-6 admin can silently delete all arena maps | `HIGH-CONFIDENCE RISK` |
| **F-H29** | ADMIN-H03 | `AdminAntiCheat.service.ts:175–181` | All anti-cheat flags (`flagHistory`) and heartbeat strike counters (`clientHeartbeat`) are deleted on `playerQuit`; a cheating player resets their entire anti-cheat record by disconnecting and reconnecting | `HIGH-CONFIDENCE RISK` |
| **F-H30** | HOPOUTS-H1 | `ArenaSpawn.validation.ts:60` | `preset.center ?? { x: preset.redSpawn.x, … }` — if `preset.center` is null AND `preset.redSpawn` is null/missing, `preset.redSpawn.x` throws `TypeError: Cannot read properties of undefined`; no `try/catch` in `isHopoutsSpawnGeometricallySafe`; can crash server process on malformed preset | `HIGH-CONFIDENCE BUG` |
| **F-H31** | HOPOUTS-H2 | `ArenaMatch.manager.ts:1590–1597` | Stale disconnect grace `setTimeout` (15 s) captures live `match` object reference; in a 1v1, if Round N ends and Round N+1 starts within 15 s of the disconnect, the stale timer fires during active Round N+1 and calls `checkRoundEnd` prematurely — Round N+1 ends incorrectly in opponent's favor | `HIGH-CONFIDENCE BUG` |
| **F-H32** | HOPOUTS-H3 | `ArenaMatch.manager.ts:1198–1199` | `beginRound` resets `p.alive = true` but does not reset `p.disconnected` or `p.roundPresenceDeadline`; stale flags from a prior disconnect persist into the new round; root cause of F-H31 | `HIGH-CONFIDENCE BUG` |
| **F-H33** | HIGH-01 | `FfaMatch.manager.ts:282–306`; `GunGameMatch.manager.ts:304–328` | Match-end stat persistence is fire-and-forget (`void (async () => {…})()`); partial DB failure leaves some players with stats committed and others not; no retry mechanism; no per-player transaction boundary | `HIGH-CONFIDENCE RISK` |
| **F-H34** | HIGH-02 | `FfaMatch.manager.ts:252,296`; `GunGameMatch.manager.ts:269,318` | Per-kill `applyKillXp` (fire-and-forget) and per-match-end `applyMatchXpResult` both call `addXp` for the same player; if the match ends while kill-XP `await`s are in-flight, both branches start `ensureStats` concurrently and one XP grant is lost | `HIGH-CONFIDENCE BUG` |
| **F-H35** | HIGH-03 | `ArenaDev.commands.ts:330–341` | `/mydim <id>` (level-6 admin) places admin in any dimension without match registration; admin can shoot match players; kills force respawn and increment `victim.deaths` with no score change; no audit log entry for `/mydim` | `HIGH-CONFIDENCE RISK` |
| **F-H36** | HIGH-04, RANK-02 | `StatsManager.ts:56–78` | `updateRankedMatchResult` has no DB-level idempotency key; in-memory `match.state === "match_end"` guard is the only protection; lost on server restart; a restart mid-finalization allows double MMR application with no detection | `HIGH-CONFIDENCE RISK` |
| **F-H37** | LCV-H1 | `WeaponPresets.service.ts:267–271,69–71` | When a weapon has no entry in `MANUAL_WEAPON_ATTACHMENTS` and no backfill entry, `attachmentData` is `undefined`; fallback code path at line 271 accepts and persists any component hash the client sent (deduplicated only) | `HIGH-CONFIDENCE BUG` |
| **F-H38** | LCV-H2 | `WeaponPresets.service.ts` (`savePreset` handler) | `equipToFreeroam` blocks calls during competitive play but `savePreset` has no equivalent guard; a player inside a match can persist match-granted weapon components to their freeroam preset | `HIGH-CONFIDENCE BUG` |
| **F-H39** | LCV-H3, H19 | `Wardrobe.event.ts:110–121` | `isValidClothesSlot` checks `drawable >= 0` and `texture >= 0` only; no upper-bound check; any non-negative integer accepted, stored in `character.appearance` JSONB, and synced to all clients | `HIGH-CONFIDENCE BUG` |
| **F-H40** | LCV-H4 | `Wardrobe.event.ts`; `shared/json/wardrobeBlockedDrawables.json` | `wardrobeBlockedDrawables.json` is consumed only by client-side `Creator.class.ts` UI picker; `saveInline` server handler never consults it; modified client can equip any blocked drawable | `HIGH-CONFIDENCE BUG` |
| **F-H41** | LCV-H5 | `Wardrobe.event.ts` (`saveClothesAndSync`) | No validation that clothing component drawables are appropriate for the character's ped model gender; female-only drawables can be applied to male characters and vice versa | `HIGH-CONFIDENCE BUG` |

---

## Section 3 — Medium Findings (40)

| Canonical ID | Source IDs | File : Line | Title | Status |
|---|---|---|---|---|
| **F-M01** | M01 | `ArenaMatch.manager.ts:527–548,1291–1302` | `completeRound` can be called simultaneously from zone kill path and tick path with no idempotency guard; double score increment possible | `HIGH-CONFIDENCE BUG` |
| **F-M02** | M02 | `ZoneSystem.ts:216–222` | Zone boundary checked against client-reported position (200 ms tick); position spoofing or high latency allows receiving zero storm damage while visually outside safe zone | `PLAUSIBLE RISK / NEEDS RUNTIME TEST` |
| **F-M03** | M03 | `ZoneSystem.ts:428–433` | Zone deaths call neither `logKill` nor the native `playerDeath` event path; admin kill logs are incomplete for storm-killed players | `HIGH-CONFIDENCE BUG` |
| **F-M04** | M04, HOPOUTS-F5 | `ArenaMatch.manager.ts:330–348` | When top-88%-distance filter reduces candidate spawn pool to 1 pair, `cyclePool = [defaultPair]` and every round uses identical spawn positions; no warning logged; favors campers | `HIGH-CONFIDENCE BUG` |
| **F-M05** | M05 | `ArenaSpawn.validation.ts` | Spawn positions not validated against current zone radius; players can spawn outside initial 200 m safe zone if map preset and zone center diverge | `HIGH-CONFIDENCE BUG` |
| **F-M06** | M06 | `GunGameMatch.manager.ts:266`; `Death.event.ts:37` | Simultaneous `playerDeath` + `server:PlayerHit` paths can both call `handleGunGameDeath` before the guard fires; potential double tier advance for same kill | `HIGH-CONFIDENCE BUG` |
| **F-M07** | M07, ADMIN-M02 | `AdminAntiCheat.service.ts:62–65` | Heartbeat nonce uses `Math.random()` — not CSPRNG; format encodes `player.id` (public) and `Date.now()` (predictable); deterministic given V8 PRNG state | `HIGH-CONFIDENCE BUG` |
| **F-M08** | M08, ADMIN-M01 | `Report.manager.ts:60–62`; `Report.event.ts:101–103` | Report rate limiting is count-based only (max 3 open); no time-based cooldown; player can cycle 3 reports endlessly once staff closes them | `HIGH-CONFIDENCE BUG` |
| **F-M09** | M09, AUTH-M03 | `Player.event.ts:244` | `parseInt(banData.lifttime)` → `NaN` on null/malformed value; `Date.now() > NaN` evaluates `false`; temporary ban with corrupt `lifttime` becomes silently permanent | `HIGH-CONFIDENCE BUG` |
| **F-M10** | M10 | Multiple server event files | No `try/catch` on DB calls in `onPlayerQuit` character save, `creator::create`, and `loginPlayer`; silent unhandled async rejection on DB failure | `HIGH-CONFIDENCE BUG` |
| **F-M11** | AUTH-M02 | `Auth.event.ts:41` | No server-side input length validation on `username` or `password` before DB query and `bcrypt.compare`; username > 32 chars causes TypeORM error / unhandled rejection | `HIGH-CONFIDENCE BUG` |
| **F-M12** | AUTH-M04 | `DiscordOAuthServer.ts:249`; `DiscordUsernameForm.tsx:73` | `pendingToken` (56-char hex) transits through CEF context; with `allow-cef-debugging: true` any player can inspect it via DevTools; playerId binding check mitigates direct theft but defense-in-depth fails | `PLAUSIBLE RISK / NEEDS RUNTIME TEST` |
| **F-M13** | AUTH-M05 | `SelectCharacter.tsx:12–13`; `Character.event.ts:132–144` | CEF `selectCharacter` sends character ID to server via `EventManager.emitServer`; with DevTools enabled any player can inspect `store.characters`, extract IDs, or submit arbitrary IDs; amplifies F-C05 exploitation | `HIGH-CONFIDENCE RISK` |
| **F-M14** | ADMIN-M03 | `Report.event.ts:96–112` | `reportedPlayerId` and `reportedPlayerName` accepted directly from client payload without verifying the ID matches an online player or that the name matches the ID | `HIGH-CONFIDENCE BUG` |
| **F-M15** | ADMIN-M04 | `Report.event.ts:108–110`; `Report.manager.ts:179–188` | Report subject and message body have no server-side maximum length; chat messages added via `addChatMessage` have no size cap; arbitrary-size report bodies accumulate in server memory | `HIGH-CONFIDENCE BUG` |
| **F-M16** | ADMIN-M05 | `Admin.event.ts:415–433`; `Admin.commands.ts:160–172` | Admin panel open and admin duty mode toggle produce no `auditLog()` entries; investigations cannot determine when an admin session began or when duty was enabled | `HIGH-CONFIDENCE RISK` |
| **F-M17** | ADMIN-M06 | `Admin.commands.ts` (all handlers) | No per-admin per-command rate limiting; a compromised admin account can ban the entire player list, `heal all`, `freeze all`, or flood chat announcements in rapid succession | `HIGH-CONFIDENCE RISK` |
| **F-M18** | HOPOUTS-M1 | `ZoneSystem.ts:62,110` | `stormDamageBank` (`Map<player.id, number>`) entries for disconnected players are not deleted on disconnect; on reconnect the player gets a new `player.id` so the old entry is never cleaned by `stopZone`; unbounded accumulation proportional to disconnect frequency | `HIGH-CONFIDENCE BUG` |
| **F-M19** | HOPOUTS-M2 | `ZoneSystem.ts:111–113` | `stopZone` `else` branch (when `getMatchByDimension` returns null) calls `outOfBoundsStart.clear()` — a module-level map shared across all concurrent matches; wipes OOB tracking for players in all active matches, not just the one being stopped | `HIGH-CONFIDENCE BUG` |
| **F-M20** | HOPOUTS-M3 | `ArenaMatch.manager.ts:1469–1470` | Reconnecting player always receives `ITEM_CONFIG.medkit.countPerRound` and `ITEM_CONFIG.plate.countPerRound` regardless of pre-disconnect usage; intentional disconnect-reconnect refreshes full consumable stock | `HIGH-CONFIDENCE BUG` |
| **F-M21** | HOPOUTS-M4 | `ArenaMatch.manager.ts:1507` | Reconnecting player receives `ARENA_ZONE_INIT` with hardcoded radius `200` regardless of current zone phase; minimap ring visually snaps from wrong to correct on next zone tick | `HIGH-CONFIDENCE BUG` |
| **F-M22** | HOPOUTS-M5 | `HopoutsZones.runtime.ts` | Ray-casting point-in-polygon algorithm is correct for consistently-wound polygons but zone upload (`HopoutsZones.asset.ts`) does not validate polygon winding order; a reversed-vertex zone inverts presence classification | `HIGH-CONFIDENCE BUG` |
| **F-M23** | HOPOUTS-M6 | `ArenaSpawn.validation.ts:74–78` | Peer-Z outlier filter (`filterSpawnPointsWithPeerZConsensus`) is bypassed when team has fewer than 3 authored spawn points; single bad authored point (e.g., roof) is not rejected by peer consensus | `HIGH-CONFIDENCE BUG` |
| **F-M24** | MED-01, FFA-MED-01 | `QueueManager.ts:43–50` | `addPlayers` is synchronous and internally safe but callers that `await` between the guard check and acting on the result expose a TOCTOU window; party member can disconnect or join another queue during that window | `PLAUSIBLE RISK / NEEDS RUNTIME TEST` |
| **F-M25** | FFA-MED-03 | `FfaMatch.manager.ts:160–162`; `GunGameMatch.manager.ts:171–173` | OOB grace timer entry deleted when player enters zone; re-exit resets `startedAt = now`; player can indefinitely reset 8-second grace by touching zone boundary every ~7 seconds | `HIGH-CONFIDENCE BUG` |
| **F-M26** | MED-04 | `ChallengeManager.ts:112–155` | Same load-modify-save race as F-C13; two near-simultaneous kills for same player lose one unit of challenge progress; `row.claimed` guard on reward claim is correct | `HIGH-CONFIDENCE BUG` |
| **F-M27** | MED-05 | `QueueManager.ts:9,111–113` | `nextDimension` counter is in-memory; resets to 1000 on server restart; any future DB-persisted dimension references (e.g., reconnect slots in DB, match history) would face collision | `HIGH-CONFIDENCE RISK` |
| **F-M28** | M13 | `WeaponComponentTintSync.module.ts` | Weapon component/tint sync has stream-in race — remote peds can appear without visual attachments until data handler fires; base-36 decode silently discards malformed entries | `PLAUSIBLE RISK / NEEDS RUNTIME TEST` |
| **F-M29** | M14, LCV-M1 | `Vehicle.class.ts:410–425` | `setTuningMod()`: `modIndex` is validated 0–99 (correct); `modValue` accepts any integer after `Math.floor()` with no upper-bound or model-specific check; invalid values persist in DB and re-applied on boot | `PLAUSIBLE RISK / NEEDS RUNTIME TEST` |
| **F-M30** | M15 | `ChatStore.ts:63` | `chatStore.messages = []` in `chatAPI.clear()` directly mutates a MobX observable outside an action; throws invariant error in `enforceActions: "always"` mode | `HIGH-CONFIDENCE BUG` |
| **F-M31** | M16 | `ArenaHud.tsx:74` | `ArenaHud` returns `null` when page is `arena_hud` but both `match` and `matchEnd` are null — blank screen with no loading/transition state shown to player | `HIGH-CONFIDENCE BUG` |
| **F-M32** | M17 | `AdminPanel.tsx:699–724` | Raw `gsap.fromTo()` in 4 `useEffect` blocks with no cleanup return; tweens continue animating on detached DOM nodes after fast panel dismissal | `HIGH-CONFIDENCE BUG` |
| **F-M33** | M18 | `Report.tsx:1346`; `AdminPanel.tsx:886` | `window.prompt()` used in staff/admin actions; blocking browser dialog; behavior in RAGE:MP CEF is undefined and may freeze the game thread | `PLAUSIBLE RISK / NEEDS RUNTIME TEST` |
| **F-M34** | M19 | `Arena.store.ts` | `lobby`, `vitals`, `minimapData` not reset on `matchEnd` or `leftMatch`; stale data from previous match visible at start of next match | `HIGH-CONFIDENCE BUG` |
| **F-M35** | M20 | `Spectate.class.ts:98` | Spectated player disconnect: client calls remote stop but not `this.stop()` locally; client stays invisible/frozen if server response is delayed or lost | `HIGH-CONFIDENCE BUG` |
| **F-M36** | M21, DC-M01 | `DamageSync.event.ts:194–197` | Team damage check: `if (victimTeam && shooterTeam && victimTeam === shooterTeam) return;` — if either team is `undefined`, `&&` short-circuits and friendly fire is NOT blocked | `HIGH-CONFIDENCE BUG` |
| **F-M37** | M22 | `WeaponPresets.service.ts:267–271` | `savePreset` stores raw client-provided component hashes for weapons absent from `MANUAL_WEAPON_ATTACHMENTS` with zero filtering; arbitrary hashes persisted to `weapon_presets.components` JSONB and re-applied on spawn | `HIGH-CONFIDENCE BUG` |
| **F-M38** | LCV-M2 | `Vehicle.entity.ts`; `Vehicle.class.ts` | `primaryColor`, `secondaryColor`, `neonColor` stored as JSON arrays with no range validation; values outside LSC palette (0–159) or RGB range (0–255) persist and are applied verbatim on vehicle load | `PLAUSIBLE RISK / NEEDS RUNTIME TEST` |
| **F-M39** | DC-M02 | `DamageSync.event.ts:307–329` | `server:BotPedHit` handler skips all three `CombatIntegrity` checks (fire rate, duplicate hit, distance); bot kills are farmable at unlimited rate | `HIGH-CONFIDENCE BUG` |
| **F-M40** | DC-M03 | `DamageSync.event.ts:295–303` | `getPedById` fallback (when `mp.peds.atRemoteId` unavailable) uses `mp.peds.at(pedId)` (pool index) then checks `ped.id === pedId`; if `.id` is pool index and `pedId` is remote ID, mismatch causes silent drop or wrong ped targeted | `PLAUSIBLE RISK / NEEDS RUNTIME TEST` |

---

## Section 4 — Low / Info Findings (25)

| Canonical ID | Source IDs | File : Line | Title | Status |
|---|---|---|---|---|
| **F-L01** | L01 | `Auth.event.ts:17–22` | Legacy SHA-256 unsalted hashes: accounts that never log in post-migration remain with single-pass SHA-256 permanently | `HIGH-CONFIDENCE RISK` |
| **F-L02** | L02 | `Admin.event.ts` | 25 `as any` casts in the most security-critical event handler file; worst type safety in the codebase | `HIGH-CONFIDENCE RISK` |
| **F-L03** | L03, CEF-M08 | Client-wide; `source/client/` | 34 `render` event handlers registered across 30 files (server count); ~236 `mp.events.add()` calls across all client files vs. 3 `mp.events.remove()` calls total; add-only event model | `HIGH-CONFIDENCE BUG` |
| **F-L04** | L04 | Various | 40+ production source files contain `console.log` calls with no `isDev` guard; generates console noise in production; may leak internal state info | `HIGH-CONFIDENCE RISK` (minor) |
| **F-L05** | L05 | `gamemode/conf.json`, `ragemp-server/conf.json` | `fqdn: "eu.loclx.io"` in both conf files — development tunnel domain left in configuration | `HIGH-CONFIDENCE BUG` |
| **F-L06** | L06, LCV-P1 | `Database.module.ts:54` | `migrations: []` — no TypeORM migrations defined; schema changes require manual DDL; `synchronize: true` in beta mode is a foot-gun if `DB_BETA` env var leaks to production | `HIGH-CONFIDENCE RISK` |
| **F-L07** | L07 | `Account.entity.ts` | Account deletion does not cascade to characters at the DB level; orphaned character rows accumulate | `HIGH-CONFIDENCE BUG` |
| **F-L08** | L08 | `Player.store.ts` | `pincode: 1234` and `wantedLevel: 5` in `Player.store` default state — dead RP system remnants never cleaned up | `HIGH-CONFIDENCE BUG` (minor) |
| **F-L09** | L09 | `Authentication.tsx:213–256` | "Network Status" sidebar is entirely hardcoded static strings; always shows ONLINE/LIVE regardless of actual server state | `HIGH-CONFIDENCE BUG` |
| **F-L10** | L10 | `Arena.store.ts:460–483` | `youKill`/`youDied` `setTimeout` IDs not stored in `_arenaDeathTimeouts`; not cancelled by `flushArenaTransientTimeouts()`; can set stale state on a new match's notification | `HIGH-CONFIDENCE BUG` |
| **F-L11** | L11 | `Voting.tsx:63` | Voting UI shows blank grid with no empty-state message when `voteMaps` is empty | `HIGH-CONFIDENCE BUG` |
| **F-L12** | L12 | `Player.prototype.ts:83` | `applyHairOverlayToEntity` uses `>> 0` to convert model hashes to signed 32-bit integers; can produce negative values for large unsigned hashes compared elsewhere | `PLAUSIBLE RISK / NEEDS RUNTIME TEST` |
| **F-L13** | L13 | `ArenaHud.tsx:258–276` | Debug simulation controls (`<details>`) visible to any player in a solo simulation; no admin gate | `HIGH-CONFIDENCE RISK` |
| **F-L14** | L14 | `Player.event.ts:30–32`; `Browser.class.ts:210–211` | 5 radar `setTimeout` calls on connect to suppress GTA's radar restoration; indicates radar init is unreliable without repeated forcing | `HIGH-CONFIDENCE BUG` (workaround smell) |
| **F-L15** | L15 | `Report.event.ts:98–110` | No input length limits on report subject/message or admin action reason fields at server handler level | `HIGH-CONFIDENCE BUG` |
| **F-L16** | L16 | Multiple | 14 `@ts-ignore` suppressions; 6 concentrated in `Player.prototype.ts` | `HIGH-CONFIDENCE RISK` (type safety) |
| **F-L17** | L17 | `authPendingBus.ts` | Any server notification resets the Discord OAuth spinner state; a welcome toast during an active OAuth flow clears the in-progress auth UI indicator | `HIGH-CONFIDENCE BUG` |
| **F-L18** | LCV-M3 | `Vehicle.entity.ts` | `plate` column (varchar 8) has no `UNIQUE` constraint; multiple vehicles can share identical plate strings | `HIGH-CONFIDENCE BUG` |
| **F-L19** | LCV-M4 | `Vehicle.entity.ts:9` | `owner_id` is an untyped `int` column with no FK to the accounts table; account deletion leaves orphaned vehicle rows; denormalized `owner_name` column drifts after account renames | `HIGH-CONFIDENCE BUG` |
| **F-L20** | LCV-M5 | `Wardrobe.event.ts` (`saveInline` handler) | No per-player cooldown on clothing saves; modified client can emit `saveInline` in a tight loop and generate DB writes at loop rate | `HIGH-CONFIDENCE RISK` |
| **F-L21** | LCV-M6 | `WeaponComponentTintSync.module.ts:72` | `giveComponentToPed()` native wrapped in try-catch; silent failure leaves server `__weaponComponents` map out of sync with client state; no retry or forced re-sync | `PLAUSIBLE RISK / NEEDS RUNTIME TEST` |
| **F-L22** | LCV-M7 | `Vehicle.entity.ts` | `class` column defaults to `-1`; no DB CHECK constraint; any out-of-range integer stored; logic gating content by vehicle class behaves unpredictably | `PLAUSIBLE RISK / NEEDS RUNTIME TEST` |
| **F-L23** | LCV-P2 | `WeaponPresets.service.ts` (`applyWeaponPresets`) | Preset component hashes loaded from DB on spawn are not re-filtered against current attachment data; historically persisted or attacker-stored hashes applied directly to native grant call | `HIGH-CONFIDENCE RISK` |
| **F-L24** | LCV-P3 | `Vehicle.class.ts` (`destroyVehicle` vs `saveVehicle`) | Server crash mid-`saveVehicle()` leaves in-memory vehicle gone but DB state at pre-crash values; no journaling or idempotency token to detect this split | `PLAUSIBLE RISK / NEEDS RUNTIME TEST` |
| **F-L25** | RANK-03 | `StatsManager.ts:15–21` | `calculateMmrDelta` silently selects `isWin` branch if both `isWin` and `isLoss` are true; current callers pass `isLoss = !isWin` so not triggered today; no assertion enforces mutual exclusivity | `PLAUSIBLE RISK / NEEDS RUNTIME TEST` |

---

## Section 5 — Verified Correct Items

| Item | Location | Verification |
|---|---|---|
| Discord OAuth state management (randomBytes, TTL, consume-once, player-bound) | `discordAuthState.ts` | `VERIFIED CORRECT` |
| Session invalidation on disconnect | `Player.event.ts` `onPlayerJoin` / `onPlayerQuit` | `VERIFIED CORRECT` |
| Noclip trust chain (adminLevel is server-set) | `Noclip.module.ts`, `Player.event.ts:363–369` | `VERIFIED CORRECT` (UNVERIFIED that `setVariable` is server-only) |
| ESP trust chain (adminLevel is server-set) | `AdminESP.module.ts:14–16` | `VERIFIED CORRECT` (same caveat) |
| `player.call()` targets one client | `Admin.commands.ts:179` | `VERIFIED CORRECT` |
| `Math.random()` is not CSPRNG | `AdminAntiCheat.service.ts:63` | `VERIFIED CORRECT` — Node.js docs confirm |
| Lag compensation design | `SnapshotManager.ts`; `DamageSync.event.ts:202–204` | `VERIFIED CORRECT` |
| Fire rate / duplicate-hit / distance validation for player-vs-player | `CombatIntegrity.ts` | `VERIFIED CORRECT` |
| FFA/GunGame isolated from ranked MMR | `FfaMatch.manager.ts:288–304`; `GunGameMatch.manager.ts:310–327` | `VERIFIED CORRECT` |
| Rank tier boundary logic | `StatsManager.ts:33–40` | `VERIFIED CORRECT` — no off-by-one; Bronze floor at 0 enforced |
| Double-end match guard (in-memory, pre-persist) | `ArenaMatch.manager.ts`; `endFfaMatch`; `endGunGameMatch` | `VERIFIED CORRECT` (in-memory only — see F-H36 for restart risk) |
| `checkRoundEnd` warmup guard | `ArenaMatch.manager.ts` | `VERIFIED CORRECT` |
| Storm damage bypasses armor | `ZoneSystem.ts:225–249` | `DESIGN CHOICE` — intentional BR norm |
| Draw round on simultaneous storm deaths | `ArenaMatch.manager.ts:1319–1325` | `VERIFIED CORRECT` — symmetric by design |
| OAuth state replay prevention | `DiscordOAuthServer.ts` | `VERIFIED CORRECT` — state consumed on first use |
| Pending token player-binding | `Auth.event.ts:106` | `VERIFIED CORRECT` |
| `claimChallengeReward` double-claim guard | `ChallengeManager.ts:177` | `VERIFIED CORRECT` |
| `mp.vehicles.forEach` soft-break pattern | `ArenaSpawn.validation.ts:84` | `VERIFIED CORRECT` (O(n) cost noted) |
| `getInitialPageFromSearchParams` as lazy initializer | `PageContext.tsx:40` | `VERIFIED CORRECT` — valid React `useState` pattern |
| `browser.markAsChat()` | `Browser.class.ts` | `VERIFIED CORRECT` |
| `mp.gui.chat.show(false)` / `.activate(false)` | `Browser.class.ts` | `VERIFIED CORRECT` |
| `mp.game.controls.setDisableControlActionBatch()` | `Browser.class.ts` | `VERIFIED CORRECT` |
| `hideHudComponentThisFrame(id)` every frame | HUD modules | `VERIFIED CORRECT` |
| `CameraMp.setActive(bool)` | `Camera.class.ts` | `VERIFIED CORRECT` |
| `mp.game.cam.renderScriptCams(…)` | `Camera.class.ts` | `VERIFIED CORRECT` |
| `mp.game.network.setInSpectatorMode(bool, handle)` | `Spectate.class.ts` | `VERIFIED CORRECT` |
| `PlayerMp.setAlpha(n)` | Various | `VERIFIED CORRECT` |
| `mp.browsers.exists(browser)` guard | `Browser.class.ts` | `VERIFIED CORRECT` |

---

## Section 6 — Engine Limitations

| Item | Location | Assessment |
|---|---|---|
| `Admin-SetGM` local event self-invocable | `AdminGodmode.module.ts:4–7` | `ENGINE LIMITATION` — A modded client can call `mp.events.call("Admin-SetGM", true)` locally to invoke `SET_ENTITY_INVINCIBLE` without server involvement. GTA V natives cannot be made server-authoritative. Practical mitigation: detect via damage registration discrepancy (player receives hits with no health change). |

---

## Section 7 — Ranked Fix Priority List

*(Verbatim from AUDIT_REPORT_FULL.md §7 for standalone use)*

### MUST FIX IMMEDIATELY

| Rank | ID | File : Line | Fix |
|------|-----|------------|-----|
| 1 | F-C01 | `DamageSync.event.ts:172` | `mp.players.at(victimId)` → `mp.players.atRemoteId(victimId)` |
| 2 | F-C06 | `.env` files | Rotate DB password + Discord secret; add `.env` to `.gitignore` |
| 3 | F-C05 | `Character.event.ts:132` | Auth gate + ownership check on `character::select` |
| 4 | F-C09 | `Chat.tsx:182` | `DOMPurify.sanitize(el.html)` or plain `textContent` |
| 5 | F-C04 | `DamageSync.event.ts:244` | `else if (ffaMatch \|\| gunGameMatch \|\| hopoutsMatch) return;` |
| 6 | F-C07 | `DamageSync.event.ts:170` | `if (shooter.getVariable("alive") === false) return;` |
| 7 | F-C11 | `Character.event.ts:148` | `if (!player.account) return player.kick(…)` |
| 8 | F-C02 | `Camera.class.ts:372` | `setInterval(fn, 0)` → `setInterval(fn, 16)` |
| 9 | F-C03 | `Player.prototype.ts:97` | `setInterval(fn)` → `setInterval(fn, 100)` |
| 10 | F-C12 | `Report.manager.ts` | Persist reports to DB |
| 11 | F-C10 | `AdminAudit.service.ts` | Persist audit entries to DB |
| 12 | F-H14 | `DiscordOAuthServer.ts:186`; `Auth.event.ts:78` | Already-authenticated guard before OAuth start and callback |
| 13 | F-H12's cousin AUTH-H01 | `Auth.event.ts:41` | Per-player failed-attempt counter; 60 s lockout after 5 failures |
| 14 | F-C13 | `StatsManager.ts`; `ProgressionManager.ts` | Atomic SQL increments (`UPDATE … SET x = x + 1`) |
| 15 | F-H04 | Both `conf.json` files | `"allow-cef-debugging": false` |

### SHOULD FIX NEXT

| Rank | ID | Fix |
|------|-----|-----|
| 16 | F-C08/F-C14 | Reject unknown weapon hashes; enforce `WEAPON_REGISTRY.enabled` |
| 17 | F-H01 | `cursor.show(showCursor, false)` |
| 18 | F-H02 | `JSON.stringify(event)` in `browser.execute()` template |
| 19 | F-H13 | Already-logged-in guard in `loginPlayer` and `enterGameWithAccount` |
| 20 | F-H12 | `req.setTimeout(10000, …)` in `discordHttps.ts` |
| 21 | F-H15 | Auth gate + type check on `creator::navigation` |
| 22 | F-H10 | Add `rsgId` to ban record |
| 23 | F-H30 | Null guard on `preset.redSpawn` in spawn validation |
| 24 | F-H31/F-H32 | Reset `disconnected`/`roundPresenceDeadline` in `beginRound` |
| 25 | F-H17 | Restore pre-disconnect HP/armor on reconnect |
| 26 | F-H18 | Count disconnect as death in match stats |
| 27 | F-H28 | `auditLog()` before zone editor destructive operations |
| 28 | F-H29 | Persist anti-cheat flag history to DB |
| 29 | F-H11 | TypeORM transactions on character and account creation |
| 30 | F-H33 | DB transactions on match-end stat persistence |
| 31 | F-H35 | Audit + block `/mydim` into active match dimensions |
| 32 | F-H36 | DB-level idempotency key before MMR delta application |
| 33 | F-H39 | Upper-bound clothing drawable validation |
| 34 | F-H40 | Enforce `wardrobeBlockedDrawables.json` server-side |
| 35 | F-H25 | Replace 4,608-node TacticalCompass with canvas/SVG loop |
| 36 | F-M11 | Input length validation on `loginPlayer` |
| 37 | F-M09 | `isNaN(liftMs)` guard on ban expiry |
| 38 | F-M07 | `crypto.randomBytes(16)` for heartbeat nonce |
| 39 | F-H27 | Per-chunk byte cap on POV frame uploads |
| 40 | F-M39 | Add `CombatIntegrity` checks to `server:BotPedHit` |

### POLISH LATER

| Rank | ID | Fix |
|------|-----|-----|
| 41 | F-M20 | Track used items on `MatchPlayer`; restore `max(0, perRound - used)` on reconnect |
| 42 | F-M25 | Accumulate total OOB time; don't reset on re-entry |
| 43 | F-M01 | `roundCompleted` idempotency flag on `completeRound` |
| 44 | F-M26 | Atomic increments for `ChallengeManager` |
| 45 | F-M08 | Time-based report rate limit (`lastReportAt`, 2-min minimum) |
| 46 | F-M14 | Server-authoritative `reportedPlayerName` lookup |
| 47 | F-M15 | Subject ≤ 128, body ≤ 1000, chat msg ≤ 500 chars |
| 48 | F-M16 | `auditLog` for panel open / duty toggle |
| 49 | F-M17 | Per-admin per-command cooldown map |
| 50 | F-C14 (spawn limit) | Vehicle spawn cap 3–5 per player |
| 51 | F-H38 | Block `savePreset` during active match |
| 52 | F-H41 | Validate clothing drawables against ped model gender |
| 53 | F-L19 | FK `vehicle.owner_id` → `account.id` with CASCADE |
| 54 | F-L18 | UNIQUE constraint on `vehicle.plate` |
| 55 | F-L20 | Per-player cooldown on `saveInline` |
| 56 | F-H20/F-H21 | `EventManager.removeHandler()` in App cleanup and store `destroyEvents()` |
| 57 | F-L10 | Track `youKill`/`youDied` timeout IDs in `_arenaDeathTimeouts` |
| 58 | F-M34 | Reset `lobby`/`vitals`/`minimapData` on `matchEnd`/`leftMatch` |
| 59 | CEF-M03 | `transitionFromBlurred(0)` at start of `emergencyReset()` |
| 60 | CEF-M05 | Destroy and recreate `AttachEditor` browser on each session |
| 61 | F-H06 | Remove destroyed camera entries from `Camera.this.list` |
| 62 | F-H08 | Store and clear Raycast `setInterval` ID in destroy path |
| 63 | F-L01 | Plan SHA-256 legacy migration: force password reset on next login |
| 64 | F-L05 | Remove `fqdn: "eu.loclx.io"` from both conf files |
| 65 | F-L07 | Cascade delete account → characters at DB level |
| 66 | F-L13 | Gate debug sim controls behind `import.meta.env.DEV` |
| 67 | F-L22 | DB CHECK constraint on vehicle `class` column range (0–24) |

---

## Section 8 — Runtime QA Checklist

*(See AUDIT_REPORT_FULL.md §8 for full annotated checklist with CURRENTLY: pass/fail status on each item)*

### Quick Reference — Known Current Failures (Static Analysis)

The following checks are **expected to fail** on the current codebase without fixes. Use as regression tests post-fix.

| # | Test | Tracking ID |
|---|------|------------|
| 1 | Connect unauthed; call `server::character:select 1` → expect: kick | F-C05 |
| 2 | Connect unauthed; call `server::character:create` → expect: kick | F-C11 |
| 3 | Call `server::creator:navigation` unauthed → expect: rejected | F-H15 |
| 4 | `loginPlayer` 30×/s with wrong password → expect: rate-limited at 5 | AUTH-H01 |
| 5 | `loginPlayer` while already logged in → expect: rejected | F-H13 |
| 6 | `loginPlayer` with 500-char username → expect: length error | F-M11 |
| 7 | Start Discord OAuth while already authed → expect: rejected | F-H14 |
| 8 | Discord API hang simulation → expect: timeout at ~10 s | F-H12 |
| 9 | Fire at enemy during warmup → expect: zero damage | F-C04 |
| 10 | Shoot a dead player → expect: events rejected | F-C07 |
| 11 | `server:PlayerHit` with `weaponHash = "weapon_rpg"` → expect: rejected | F-C08 |
| 12 | `setWeaponTint` with tint index 255 → expect: clamped | LCV-C2 |
| 13 | Char A: `server::character:select` with char owned by account B → expect: kick | F-C05 |
| 14 | Upload preset with `center: null`, `redSpawn: null` → expect: no crash | F-H30 |
| 15 | 1v1: disconnect Round N; reconnect Round N+1 active; wait 15 s → expect: Round N+1 continues | F-H31 |
| 16 | Use all medkits; disconnect; reconnect → expect: count preserved | F-M20 |
| 17 | `equipToFreeroam` with `weapon_rpg` → expect: blocked | F-C14 |
| 18 | `saveInline` with `drawable: 2147483647` → expect: rejected | F-H39 |
| 19 | `saveInline` with drawable in blocked list → expect: rejected | F-H40 |
| 20 | Spawn 50 freeroam vehicles → expect: limit at 3–5 | F-C14/LCV-C3 |
| 21 | Chat XSS: `<img src=x onerror=alert(1)>` → expect: escaped | F-C09 |
| 22 | Open any UI; move mouse to screen corner → expect: cursor tracks freely | F-H01 |
| 23 | Emergency reset with blurred world → expect: blur clears | CEF-M03 |
| 24 | FFA zone boundary oscillation every ~7 s → expect: forced out at 8 s total | F-M25 |
| 25 | 10 rapid kills near match end; check DB XP = 250 exactly | F-C13 |
| 26 | `/mydim` into active match dimension → expect: blocked/audited | F-H35 |
| 27 | Server restart → expect: audit log empty | F-C10 (document gap) |
| 28 | Server restart → expect: all reports gone | F-C12 (document gap) |
| 29 | Anti-cheat flags: disconnect + reconnect → expect: flags persist | F-H29 |
| 30 | TacticalCompass DevTools paint time → expect: < 4 ms/frame | F-H25 |

### Known Current Passes (Do Not Regress)

| # | Test | Tracking ID |
|---|------|------------|
| 1 | Discord OAuth state replay (second callback attempt) → correctly rejected | VERIFIED CORRECT |
| 2 | Discord OAuth TTL expiry at 16 min → correctly expired | VERIFIED CORRECT |
| 3 | `server::creator:create` unauthed → correctly kicks | VERIFIED CORRECT |
| 4 | Rapid-fire `server:PlayerHit` beyond RPM → fire rate limit enforced | VERIFIED CORRECT |
| 5 | `character::select` non-existent ID → correctly shows error | VERIFIED CORRECT |
| 6 | FFA match complete → query `player_stats.mmr` unchanged | VERIFIED CORRECT |
| 7 | `endMatch` called twice → stats written once (in-memory guard) | VERIFIED CORRECT |
| 8 | Simultaneous storm deaths → round scored "draw", score unchanged | VERIFIED CORRECT |
| 9 | Non-admin `server::admin:espMode` → correctly rejected | VERIFIED CORRECT |
| 10 | Non-admin `server::player:noclip` → correctly rejected | VERIFIED CORRECT |

---

*End of AUDIT_FINDINGS_FULL.md.*
*All findings sourced exclusively from the nine subsystem audit files listed in the header.*
*No findings were invented or inferred beyond what appears in those source documents.*
