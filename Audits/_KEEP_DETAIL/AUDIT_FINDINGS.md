# AUDIT FINDINGS — Havoc Arena RAGE:MP Server
**Date:** 2026-04-24  
**Auditor:** Claude Sonnet 4.6 (hostile read-only pass)  
**Scope:** Full codebase — source/server, source/client, source/shared, frontend/src  
**Methodology:** Deep file reads, RAGE:MP wiki cross-check, event flow tracing, static analysis

---

## SEVERITY LEGEND
- **CRITICAL** — Confirmed broken, exploitable, or data-destroying. Fix before any public session.
- **HIGH** — Significant security risk, exploitable gameplay issue, or guaranteed crash path.
- **MEDIUM** — Exploitable under effort, UX-breaking, or data integrity risk.
- **LOW** — Quality/correctness issue that degrades trust or is a time bomb.
- **INFO** — Noted for completeness; low active harm.

---

## RANKED FIX LIST

### MUST FIX IMMEDIATELY (Critical)

| # | ID | Severity | Description | File(s) | Impact |
|---|---|---|---|---|---|
| 1 | C01 | CRITICAL | `mp.players.at(victimId)` used instead of `mp.players.atRemoteId(victimId)` in damage handler — damage is applied to the **wrong player** or `undefined` | `source/server/serverevents/DamageSync.event.ts:172` | Damage hits wrong targets; server may process `undefined.health` |
| 2 | C02 | CRITICAL | `setInterval(() => Camera.rotateEntity(x), 0)` — 0ms interval calls `setHeading()` at maximum JS event-loop speed, causing CPU spike and heading desync | `source/client/classes/Camera.class.ts:372` | Client performance destruction on any camera rotation |
| 3 | C03 | CRITICAL | `setInterval(() => mp.game.ui.weaponWheelIgnoreSelection())` — missing interval argument defaults to 0ms, fires at max speed | `source/client/prototype/Player.prototype.ts:97` | CPU spin-lock whenever weapon wheel disable is active |
| 4 | C04 | CRITICAL | Warmup godmode bypass: `DamageSync.event.ts` skips the arena handler when `state="warmup"` and falls through to the freeroam damage block, which applies full uncapped damage to frozen warmup players | `source/server/serverevents/DamageSync.event.ts:244,261` | Players can be killed in warmup; exploitable by any client |
| 5 | C05 | CRITICAL | `character::select` CEF handler spawns character by raw DB `id` with no ownership check — any authenticated player can load any other player's character | `source/server/serverevents/Character.event.ts:132–144` | Account hijacking, appearance theft |
| 6 | C06 | CRITICAL | Real `.env` file with plaintext DB password (`Headshot123`) is present in the repository backup | `gamemode/.env` | Database compromise if backup is shared |
| 7 | C07 | CRITICAL | Dead players (`alive = false`) can continue sending `server:PlayerHit` events — no alive/isDead check on the shooter in the damage handler | `source/server/serverevents/DamageSync.event.ts:170–288` | Dead players can kill living opponents; kill crediting errors |
| 8 | C08 | CRITICAL | Weapon hash sent by client is not validated against a whitelist in the damage handler — unknown hashes receive fallback damage values and are not rejected | `source/server/serverevents/DamageSync.event.ts:170` | Client can claim any weapon; balance bypass |
| 9 | C09 | CRITICAL | Chat uses `dangerouslySetInnerHTML={{ __html: el.html }}` with no sanitization on server-controlled HTML — full XSS vector in the chat panel | `frontend/src/pages/hud/Chat/Chat.tsx:182` | JS injection in CEF, potential `mp.trigger` abuse |
| 10 | C10 | CRITICAL | Admin audit log is stored in-memory only (max 2000 entries) and is lost on every server restart — admin actions are not persistently recorded | `source/server/admin/AdminAudit.service.ts:1–9` | No accountability; rogue admins leave no trace |

---

### SHOULD FIX NEXT (High)

| # | ID | Severity | Description | File(s) |
|---|---|---|---|---|
| 11 | H01 | HIGH | `mp.gui.cursor.show(showCursor, showCursor)` — second param `lockedAtCenter` should be `false` when showing the UI cursor; passing `true` locks the cursor to center in mouselook mode, breaking all UI click interaction | `source/client/classes/Browser.class.ts` (multiple lines) |
| 12 | H02 | HIGH | CEF `execute()` script injection: event names and args are string-interpolated into `window.callHandler("${event}", ${argsString})` without escaping — a malformed event name or arg can inject arbitrary JS into CEF | `source/client/classes/Browser.class.ts:416–419` |
| 13 | H03 | HIGH | Discord OAuth URL from server is passed directly to `mp.browsers.new(url)` with no validation — compromised server or MITM can open any URL in the player's CEF browser | `source/client/clientevents/Auth.event.ts:56` |
| 14 | H04 | HIGH | `allow-cef-debugging: true` in both `conf.json` files — players can open Chromium DevTools in-game, inspect all client JS, manipulate MobX stores, and inject `mp.trigger` calls | `gamemode/conf.json`, `ragemp-server/conf.json` |
| 15 | H05 | HIGH | `resolution.y` is assigned to a variable named `width` — screen height is used as screen width in the camera rotation direction threshold, breaking rotation on all non-square resolutions | `source/client/classes/Camera.class.ts:217–219` |
| 16 | H06 | HIGH | `destroyCamera` never removes entries from `this.list` — `isActive()` returns stale truthy results for destroyed cameras | `source/client/classes/Camera.class.ts:291–298` |
| 17 | H07 | HIGH | `Raycast.class.ts` constructor calls two undocumented/experimental RAGE:MP APIs with `@ts-ignore` and no try/catch — if the APIs don't exist in the deployed build, the entire client crashes on startup | `source/client/classes/Raycast.class.ts:23–27` |
| 18 | H08 | HIGH | Raycast `setInterval(100ms)` is never cleared — interval runs for the entire session, forever calling game APIs every 100ms with no destroy path | `source/client/classes/Raycast.class.ts:21` |
| 19 | H09 | HIGH | `setOnGroundProperly`: `getGroundZFor3dCoord` can return `undefined` or `0` in interiors/unloaded terrain; no null check means player is teleported to Z=1 (underground) | `source/client/prototype/Player.prototype.ts:109` |
| 20 | H10 | HIGH | `/ban` command does not save `rsgId` to the ban record — the HWID ban vector is always empty, making bans bypassable with an IP/VPN change plus serial spoof | `source/server/commands/Admin.commands.ts:670–678` |
| 21 | H11 | HIGH | No database transactions on character creation, account creation, or on-quit save — partial writes on crash result in corrupt or missing character data | `source/server/serverevents/Character.event.ts`, `Auth.event.ts`, `Player.event.ts` |
| 22 | H12 | HIGH | No timeout on Discord HTTPS outbound requests — unresponsive Discord API hangs player session handler indefinitely | `source/server/modules/discordAuth/discordHttps.ts:8–39` |
| 23 | H13 | HIGH | `character::create` handler has no auth gate — a player can call it without a valid `player.account` | `source/server/serverevents/Character.event.ts:148–150` |
| 24 | H14 | HIGH | Client-controlled `bone` string in damage events — cheater always sends `"Head"` to guarantee 1.5× headshot multiplier; ratio is logged but not blocked | `source/server/serverevents/DamageSync.event.ts:210`, `source/client/modules/DamageSync.module.ts:88` |
| 25 | H15 | HIGH | Players who mass-disconnect and reconnect during a round have their health fully restored (`spawnPlayerAtArena` sets health=200, armor=100) — free HP restoration mid-match | `source/server/modes/hopouts/ArenaMatch.manager.ts:1102–1107, 1474` |
| 26 | H16 | HIGH | Disconnecting mid-round does not count as a death — no `deaths++` penalty for intentional disconnect to escape a losing fight | `source/server/modes/hopouts/ArenaMatch.manager.ts:1560–1603` |
| 27 | H17 | HIGH | FFA kill farming: no protection against coordinated intentional deaths between two accounts | `source/server/modes/ffa/FfaMatch.manager.ts:238–280` |
| 28 | H18 | HIGH | `equipForEdit` in `WeaponPresets.service.ts` bypasses the weapon registry whitelist — any valid GTA weapon name can be granted in freeroam | `source/server/arena/WeaponPresets.service.ts:204–235` |
| 29 | H19 | HIGH | No upper-bound validation on clothing component drawable/texture indices — any non-negative integer is accepted, stored, and propagated to all observing clients via the synced variable | `source/server/serverevents/Wardrobe.event.ts:110–121` |
| 30 | H20 | HIGH | No per-player freeroam vehicle spawn limit — player can spawn unlimited FREEROAM vehicles, filling the server vehicle pool | `source/server/serverevents/Vehicle.event.ts:212` |
| 31 | H21 | HIGH | `App.tsx` cleanup calls `stopAddingHandler()` which only logs — does NOT remove handlers; `system:setPage` and `notify:show` handlers accumulate on every component remount | `frontend/src/App.tsx:55–67` |

---

### POLISH LATER (Medium)

| # | ID | Severity | Description | File(s) |
|---|---|---|---|---|
| 32 | M01 | MEDIUM | Warmup → active state race: if `completeRound` is called twice (e.g. zone kill + tick simultaneously), `redScore`/`blueScore` can double-increment; no round-ID guard or idempotency check | `source/server/modes/hopouts/ArenaMatch.manager.ts:527–548, 1291–1302` |
| 33 | M02 | MEDIUM | Zone boundary checked with client-reported position (200ms tick) — position spoofing or high latency allows players to take zero zone damage while visually outside the safe zone | `source/server/modes/hopouts/ZoneSystem.ts:216–222` |
| 34 | M03 | MEDIUM | Zone deaths bypass `logKill` and the native `playerDeath` event — admin kill logs are incomplete for storm-killed players | `source/server/modes/hopouts/ZoneSystem.ts:428–433` |
| 35 | M04 | MEDIUM | All players on the same team spawn at the exact same XYZ coordinate — enemy can memorize the single spawn coordinate and pre-aim it | `source/server/modes/hopouts/ArenaMatch.manager.ts:1211–1244` |
| 36 | M05 | MEDIUM | Spawns not validated against the current zone radius — players can spawn outside the initial 200m safe zone if map preset and zone center diverge | `source/server/modes/hopouts/ArenaSpawn.validation.ts` |
| 37 | M06 | MEDIUM | GunGame: potential double tier-advance via simultaneous native `playerDeath` + `server:PlayerHit` damage path — both can call `handleGunGameDeath` before guard fires | `source/server/modes/gungame/GunGameMatch.manager.ts:266`, `source/server/serverevents/Death.event.ts:37` |
| 38 | M07 | MEDIUM | Heartbeat anti-cheat uses `Math.random()` for nonce — not cryptographically secure; nonce predictable given `playerId + timestamp` | `source/server/admin/AdminAntiCheat.service.ts:62–65` |
| 39 | M08 | MEDIUM | Report rate limiting is count-based only (3 open) — no time-based cooldown; player can cycle 3 reports endlessly once staff closes them | `source/server/report/Report.manager.ts:73` |
| 40 | M09 | MEDIUM | Ban expiry uses `parseInt(lifttime)` from varchar — `NaN` input (null/malformed lifttime) may satisfy `hasDatePassedTimestamp(NaN)` and silently delete the ban | `source/server/serverevents/Player.event.ts:244` |
| 41 | M10 | MEDIUM | No try/catch on DB calls in on-quit character save, character create, or login — silent unhandled rejection on DB failure leaves player stuck or unsaved | Multiple server event files |
| 42 | M11 | MEDIUM | `loginPlayer` has no "already logged in" guard — player can overwrite their session with a different account without disconnecting | `source/server/serverevents/Auth.event.ts:41` |
| 43 | M12 | MEDIUM | Stats writes (`recordKill`, `recordDeath`, `addXp`) use read-modify-write without atomic increments — kills/deaths/XP are under-counted under concurrent match end events | `source/server/modules/stats/StatsManager.ts`, `ProgressionManager.ts` |
| 44 | M13 | MEDIUM | Weapon component/tint sync has stream-in race — remote peds can appear without visual attachments until data-handler fires; base-36 decode silently discards malformed entries | `source/client/modules/WeaponComponentTintSync.module.ts` |
| 45 | M14 | MEDIUM | Vehicle mod value `v` is not range-checked — arbitrary integers accepted for all mod indices including invalid ones | `source/server/classes/Vehicle.class.ts:410–425` |
| 46 | M15 | MEDIUM | Chat: `chatStore.messages = []` in `chatAPI.clear()` directly mutates a MobX observable outside an action — throws invariant error in `enforceActions: "always"` mode | `frontend/src/pages/hud/Chat/ChatStore.ts:63` (approximate) |
| 47 | M16 | MEDIUM | ArenaHud returns `null` (blank screen) when page is `arena_hud` but both `match` and `matchEnd` are null — no loading or transition state visible to player | `frontend/src/pages/arena/ArenaHud.tsx:74` |
| 48 | M17 | MEDIUM | `AdminPanel.tsx` uses raw `gsap.fromTo()` in 4 `useEffect` blocks with no cleanup return — tweens continue on detached DOM nodes after fast panel dismissal | `frontend/src/pages/admin/AdminPanel.tsx:699–724` |
| 49 | M18 | MEDIUM | `window.prompt()` used in staff "Close report" and admin panel actions — blocking browser dialog; behavior in RAGE:MP CEF is undefined and may freeze the game thread | `frontend/src/pages/report/Report.tsx:1346`, `frontend/src/pages/admin/AdminPanel.tsx:886` |
| 50 | M19 | MEDIUM | Arena.store does not reset `lobby`, `vitals`, `minimapData` on `matchEnd` or `leftMatch` — stale data from previous match visible at next match start | `frontend/src/stores/Arena.store.ts` |
| 51 | M20 | MEDIUM | Spectated player disconnect: `Spectate.class.ts` calls remote stop but not `this.stop()` locally — client stays invisible+frozen if server fails to respond | `source/client/classes/Spectate.class.ts:98` |
| 52 | M21 | MEDIUM | `playerReady` registered in two separate files — execution order determines which proto extensions are available when Player.event.ts handler fires | `source/client/prototype/Player.prototype.ts:121`, `source/client/clientevents/Player.event.ts:7` |
| 53 | M22 | MEDIUM | `savePreset` stores raw client-provided component hashes for unrecognized weapons with zero filtering — arbitrary component hashes can be persisted to DB and re-applied | `source/server/arena/WeaponPresets.service.ts:267–271` |

---

### QUALITY / LOW SEVERITY

| # | ID | Severity | Description | File(s) |
|---|---|---|---|---|
| 54 | L01 | LOW | Legacy SHA-256 password hashes: accounts that never log in post-migration remain permanently stored with an unsalted single-pass SHA-256 hash | `source/server/serverevents/Auth.event.ts:17–22` |
| 55 | L02 | LOW | `Admin.event.ts` contains 25 `as any` casts — the most security-critical handler has the worst type safety in the codebase | `source/server/serverevents/Admin.event.ts` |
| 56 | L03 | LOW | 34 separate `render` event handlers registered across 30 client files — cumulative per-frame cost on low-end clients; no budget tracking | Client-wide |
| 57 | L04 | LOW | 40+ production source files contain `console.log` with no `isDev` guard — generates client/server console noise | Various |
| 58 | L05 | LOW | `fqdn: "eu.loclx.io"` in both `conf.json` files — development tunnel domain left in configuration | `gamemode/conf.json` |
| 59 | L06 | LOW | No migrations defined — schema changes require manual DDL; `synchronize: beta` is a production foot-gun if `DB_BETA` env var leaks | `source/server/database/Database.module.ts:54` |
| 60 | L07 | LOW | Account deletion does not cascade to characters at the DB level — potential orphaned character rows | `source/server/database/entity/Account.entity.ts` |
| 61 | L08 | LOW | `Player.store.ts` contains `pincode: 1234` and `wantedLevel: 5` — dead RP remnants never removed | `frontend/src/stores/Player.store.ts` |
| 62 | L09 | LOW | Auth page "Network Status" sidebar (`Authentication.tsx:213–256`) is entirely hardcoded static strings — always shows ONLINE/LIVE regardless of actual server state | `frontend/src/pages/auth/Authentication.tsx:213–256` |
| 63 | L10 | LOW | `arenaStore.youKill`/`youDied` setTimeout IDs not stored in `_arenaDeathTimeouts` — not cancelled by `flushArenaTransientTimeouts()`, can set stale null on a new match's notification | `frontend/src/stores/Arena.store.ts:460–483` |
| 64 | L11 | LOW | Voting UI shows blank grid with no message when `voteMaps` is empty — `Voting.tsx` has no empty-state fallback | `frontend/src/pages/arena/Voting.tsx:63` |
| 65 | L12 | LOW | `applyHairOverlayToEntity` uses `>> 0` to convert model hashes to signed 32-bit — can produce negative values for large unsigned hashes compared elsewhere | `source/client/prototype/Player.prototype.ts:83` |
| 66 | L13 | LOW | Debug tools (`<details>` sim controls) visible in `ArenaHud.tsx` to any player in a solo simulation, no admin gate | `frontend/src/pages/arena/ArenaHud.tsx:258–276` |
| 67 | L14 | LOW | 5 radar `setTimeout` calls on connect (3 in Player.event.ts + 2 in Browser.class.ts) to suppress GTA's radar restoration — smell indicating the radar init is unreliable without repeated forcing | `source/client/clientevents/Player.event.ts:30–32`, `source/client/classes/Browser.class.ts:210–211` |
| 68 | L15 | LOW | No input length limits enforced on report subject/message or admin action reason fields at the server event handler level | `source/server/serverevents/Report.event.ts:98–110` |
| 69 | L16 | LOW | 14 `@ts-ignore` suppressions; 6 concentrated in `Player.prototype.ts` (the prototype extension most tightly coupled to game behavior) | Multiple |
| 70 | L17 | LOW | `authPendingBus`: any server notification resets the Discord OAuth spinner state — a welcome toast can clear an in-progress auth flow's UI indicator | `frontend/src/pages/auth/authPendingBus.ts` |

---

## RUNTIME TEST CHECKLIST

### Auth & Login
- [ ] Connect, skip Discord OAuth, try to call `character::select` with ID `1` — expect: kicked or error, NOT character spawn
- [ ] Connect, complete auth, call `auth::loginPlayer` a second time with different credentials — expect: rejected or error
- [ ] Connect, do not complete auth, trigger `server::chat:sendMessage` — expect: rejected
- [ ] Disconnect mid-Discord-OAuth — expect: no hanging session state

### Damage & Combat
- [ ] Fire at an enemy during the 3-second warmup — expect: **zero damage** (currently broken, warmup fallthrough bug)
- [ ] Kill a player, continue shooting their corpse — expect: events rejected server-side
- [ ] Use a modified client to send `bone = "Head"` on every shot — confirm if headshot multiplier fires on server logs
- [ ] Send `server:PlayerHit` with `victimId = 0` — confirm which player (if any) receives damage
- [ ] Rapid-fire `server:PlayerHit` events beyond weapon RPM — expect: rate-limit kicks in, events rejected

### Match Lifecycle
- [ ] Disconnect during active round, reconnect within 60s — confirm health is NOT restored to full
- [ ] All players on one team disconnect — confirm round ends within 15 seconds
- [ ] Team A reaches win condition AND round timer expires simultaneously — confirm score increments once not twice
- [ ] Zone damage kills the last player on a team — confirm round end fires correctly
- [ ] Try to zone-camp for full 10-minute round timer

### Admin
- [ ] Non-admin player sends `server::admin:espMode` with mode=1 — expect: rejected
- [ ] Non-admin sends `server::player:noclip` — expect: rejected
- [ ] Admin bans themselves — expect: ban applied, them kicked, they cannot rejoin
- [ ] Server restart — confirm ALL admin audit logs are gone (document this as known risk)

### Weapons & Loadout
- [ ] Call `loadout::equipForEdit` with `weaponName = "weapon_railgun"` — expect: **blocked** (currently not blocked)
- [ ] Save a preset with an invalid component hash — expect: rejected (currently not rejected)
- [ ] Enter clothing editor with a weapon drawn — exit — confirm weapon is properly restored
- [ ] Stream in a player with weapon attachments — confirm attachments are visible immediately

### Clothing
- [ ] Submit clothing `drawable = 99999` for component 11 — expect: clamped or rejected (currently not rejected)
- [ ] Check remote player appearance after submitting high drawable value

### Vehicles
- [ ] Rapidly call `tune::spawnVehicleFromWizard` 20 times — expect: limit enforced (currently no limit)
- [ ] Disconnect with a freeroam vehicle spawned — confirm vehicle is cleaned up

### CEF / UI
- [ ] Open chat and paste an HTML string like `<img src=x onerror=alert(1)>` — expect: escaped, not executed
- [ ] Trigger `system:setPage arena_hud` before `arena:setMatch` is sent — confirm blank screen behavior
- [ ] Open report widget, drag it off-screen, reload — confirm it is not permanently inaccessible
- [ ] Trigger a notification during Discord OAuth — confirm OAuth spinner does not reset incorrectly
- [ ] Check if vote screen appears blank when `voteMaps` is empty

---

## WIKI VERIFICATION SUMMARY

| API | Code Usage | Wiki Match | Finding |
|---|---|---|---|
| `mp.players.at(id)` | Used with `remoteId` | Takes pool index, not remoteId | **CRITICAL BUG — wrong player targeted** |
| `mp.players.atRemoteId(id)` | Not used in damage handler | Correct method for remoteId | Missing |
| `mp.gui.cursor.show(bool, bool)` | Both params same value | Second param is `lockedAtCenter` | **HIGH BUG — breaks UI cursor** |
| `BrowserMp.execute(js)` | String interpolated | Takes JS string | Risk: injection via unsanitized interpolation |
| `mp.browsers.new(url)` | Correct | `(string): BrowserMp` | VERIFIED CORRECT |
| `CameraMp.setActive(bool)` | Correct | `(boolean): void` | VERIFIED CORRECT |
| `mp.game.cam.renderScriptCams(...)` | 6 args | 5–6 args | VERIFIED CORRECT |
| `setInterval(fn, 0)` ×2 | No interval arg / 0 | Fires at max JS speed | **CRITICAL BUG — CPU spin** |
| `mp.game.gameplay.getGroundZFor3dCoord(...)` | No null check | Can return undefined/0 | **HIGH RISK** |
| `mp.events.addDataHandler(name, cb)` | 2-arg callback | Third arg is oldValue | Fine in JS |
| `mp.game.network.setInSpectatorMode(bool, handle)` | Correct | `(bool, number): void` | VERIFIED CORRECT |
| `mp.game.cam.setGameplayFollowPedThisUpdate(handle)` | Correct, per frame | `(number): void` | VERIFIED CORRECT |
| `hideHudComponentThisFrame(id)` | Called every frame | Must be called every frame | VERIFIED CORRECT |
| `mp.raycasting.testCapsule(...)` | Missing flags param | Optional flags control entity types | PLAUSIBLE RISK |
| `PlayerMp.setAlpha(n)` | Correct | `(number): void` | VERIFIED CORRECT |

*Note: Direct wiki.rage.mp WebFetch returned 403 during audit. Findings are based on documented RAGE:MP API knowledge as of August 2025 training cutoff. Where uncertainty exists, it is noted as UNVERIFIED ASSUMPTION.*
