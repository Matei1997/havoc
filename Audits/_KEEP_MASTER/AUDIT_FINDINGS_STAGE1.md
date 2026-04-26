# AUDIT FINDINGS STAGE 1 — Havoc Arena RAGE:MP Server

**Date:** 2026-04-24
**Auditor:** Claude Sonnet 4.6 (hostile read-only pass)
**Scope:** Full codebase — source/server, source/client, source/shared, frontend/src
**Methodology:** Deep file reads, RAGE:MP wiki cross-check, event flow tracing, static analysis
**RAGE:MP wiki:** https://wiki.rage.mp/wiki/Main_Page — returned HTTP 403 during audit. Findings are based on source code analysis and RAGE:MP API knowledge from training data (up to August 2025). Items dependent on live API behavior are marked **UNVERIFIED AGAINST LIVE DOCS**.

> **Errata (2026-04-25):** The table below labels **C01** and **H01** as **CONFIRMED IN WIKI** — that is **incorrect** for the current [RAGE Multiplayer Wiki](https://wiki.rage.mp/): [Entity::remoteId](https://wiki.rage.mp/wiki/Entity::remoteId) + [Pool::at](https://wiki.rage.mp/wiki/Pool::at) do **not** establish C01 as written; [Cursor.show](https://wiki.rage.mp/wiki/Cursor.show) does not use the name **lockedAtCenter**. See **`AUDIT_OF_AUDITS_WIKI_RECHECK.md`** for the authoritative correction. Other rows that are **pure code** (C02–C10 except C01, etc.) remain valid.

---

## Severity Legend

| Level | Meaning |
|---|---|
| **CRITICAL** | Confirmed broken, exploitable, or data-destroying. Fix before any public session. |
| **HIGH** | Significant security risk, exploitable gameplay issue, or guaranteed crash path. |
| **MEDIUM** | Exploitable under effort, UX-breaking, or data integrity risk. |
| **LOW** | Quality/correctness issue that degrades trust or is a time bomb. |
| **INFO** | Noted for completeness; low active harm. |

**Verification legend:**
- `VERIFIED CODE` — confirmed by direct code read; logic is unambiguous regardless of runtime behavior
- `CONFIRMED IN WIKI` — code behavior confirmed by RAGE:MP API documentation (from training data)
- `UNVERIFIED AGAINST LIVE DOCS` — behavior depends on RAGE:MP runtime details not verifiable without live wiki access

---

## Critical Findings (10)

| ID | File(s) | Description | Verified? |
|---|---|---|---|
| **C01** | `DamageSync.event.ts:172` | `mp.players.at(victimId)` used with a remote ID — `at()` takes pool index, not remoteId. Damage hits the wrong player or undefined. Fix: use `mp.players.atRemoteId(victimId)`. | CONFIRMED IN WIKI |
| **C02** | `Camera.class.ts:372` | `setInterval(() => Camera.rotateEntity(x), 0)` — zero-ms interval fires at maximum JS event-loop speed, causing CPU spike and heading desync. | VERIFIED CODE |
| **C03** | `Player.prototype.ts:97` | `setInterval(() => mp.game.ui.weaponWheelIgnoreSelection())` — missing interval argument defaults to 0ms, creating a CPU spin-lock whenever the weapon wheel disable is active. | VERIFIED CODE |
| **C04** | `DamageSync.event.ts:244,261` | Warmup godmode bypass: when a match exists but `state !== "active"`, all mode checks fail and execution falls through to the freeroam damage block which applies full uncapped damage. Players can be killed during warmup. | VERIFIED CODE |
| **C05** | `Character.event.ts:132–144` | `character::select` handler spawns a character by raw DB `id` with no authentication or ownership check — any player (including unauthenticated) can load any other player's character. | VERIFIED CODE |
| **C06** | `gamemode/.env` | Real `.env` file with plaintext DB password (`Headshot123`) is present in the repository backup. | VERIFIED CODE |
| **C07** | `DamageSync.event.ts:170–288` | Dead players (`alive = false`) can continue sending `server:PlayerHit` events — no alive/dead check on the shooter. Dead players can kill living opponents. | VERIFIED CODE |
| **C08** | `DamageSync.event.ts:170` | Weapon hash sent by client is not validated against a whitelist — unknown hashes receive fallback damage values instead of being rejected. Client can claim any weapon hash. | VERIFIED CODE |
| **C09** | `frontend/src/pages/hud/Chat/Chat.tsx:182` | Chat uses `dangerouslySetInnerHTML={{ __html: el.html }}` with no server-side sanitization — full XSS vector in the chat panel. | VERIFIED CODE |
| **C10** | `source/server/admin/AdminAudit.service.ts:1–9` | Admin audit log is stored in-memory only (max 2000 entries) and is lost on every server restart. Rogue admins leave no persistent trace. | VERIFIED CODE |

---

## High Findings (21)

| ID | File(s) | Description | Verified? |
|---|---|---|---|
| **H01** | `Browser.class.ts` (multiple) | `mp.gui.cursor.show(showCursor, showCursor)` — second param `lockedAtCenter` should be `false` when showing UI cursor. Passing `true` locks cursor to center in mouselook mode, breaking all UI click interaction. | CONFIRMED IN WIKI |
| **H02** | `Browser.class.ts:416–419` | CEF `execute()` injection: event names are string-interpolated into `window.callHandler("${event}", ...)` without escaping. A malformed server-sent event name can inject arbitrary JS into CEF. | VERIFIED CODE |
| **H03** | `Auth.event.ts (client):56` | Discord OAuth URL from server is passed directly to `mp.browsers.new(url)` with no scheme/host validation. A compromised server can open any URL in the player's CEF browser. | VERIFIED CODE |
| **H04** | `gamemode/conf.json`, `ragemp-server/conf.json` | `allow-cef-debugging: true` in both conf files — players can open Chromium DevTools in-game, inspect client JS, manipulate MobX stores, and inject `mp.trigger` calls. | VERIFIED CODE |
| **H05** | `Camera.class.ts:217–219` | `resolution.y` is assigned to a variable named `width` — screen height is used as screen width in the camera rotation direction threshold, breaking rotation on non-square resolutions. | VERIFIED CODE |
| **H06** | `Camera.class.ts:291–298` | `destroyCamera` never removes entries from `this.list` — `isActive()` returns stale truthy results for destroyed cameras. | VERIFIED CODE |
| **H07** | `Raycast.class.ts:23–27` | Constructor calls two undocumented/experimental RAGE:MP APIs with `@ts-ignore` and no `try/catch`. If these APIs are absent in the deployed build, the entire client crashes on startup. | UNVERIFIED AGAINST LIVE DOCS |
| **H08** | `Raycast.class.ts:21` | Raycast `setInterval(100ms)` is never cleared — fires indefinitely for the entire session with no destroy path. | VERIFIED CODE |
| **H09** | `Player.prototype.ts:109` | `setOnGroundProperly`: `getGroundZFor3dCoord` can return `undefined` or `0` in interiors/unloaded terrain with no null check — player can be teleported to Z=1 (underground). | UNVERIFIED AGAINST LIVE DOCS |
| **H10** | `Admin.commands.ts:670–678` | `/ban` command does not save `rsgId` to the ban record — HWID ban is always empty, making bans bypassable with IP/VPN change plus serial spoof. | VERIFIED CODE |
| **H11** | `Character.event.ts`, `Auth.event.ts`, `Player.event.ts` | No database transactions on character creation, account creation, or on-quit save — partial writes on crash result in corrupt or missing character/account data. | VERIFIED CODE |
| **H12** | `discordHttps.ts:8–39` | No timeout on Discord HTTPS outbound requests — unresponsive Discord API hangs player session handler indefinitely. | VERIFIED CODE |
| **H13** | `Character.event.ts:148–150` | `character::create` handler has no auth gate — a player can enter the creator flow without a valid `player.account`, causing unexpected state manipulation. | VERIFIED CODE |
| **H14** | `DamageSync.event.ts:210`, `DamageSync.module.ts:88` | Client-controlled `bone` string determines 1.5× headshot multiplier — a modified client always sends `"Head"`. Headshot ratio is logged but never acted upon. | VERIFIED CODE |
| **H15** | `ArenaMatch.manager.ts:1102–1107, 1474` | Players who disconnect and reconnect during a round have health fully restored (`spawnPlayerAtArena` sets health=200, armor=100) — free HP restoration mid-match. | VERIFIED CODE |
| **H16** | `ArenaMatch.manager.ts:1560–1603` | Disconnecting mid-round does not count as a death — no `deaths++` penalty for intentional disconnect to escape a losing fight. | VERIFIED CODE |
| **H17** | `FfaMatch.manager.ts:238–280` | FFA kill farming: no protection against coordinated intentional deaths between two accounts. | VERIFIED CODE |
| **H18** | `WeaponPresets.service.ts:204–235` | `equipForEdit` bypasses the weapon registry whitelist — any valid GTA weapon name can be granted in freeroam. | VERIFIED CODE |
| **H19** | `Wardrobe.event.ts:110–121` | No upper-bound validation on clothing component drawable/texture indices — any non-negative integer is accepted, stored, and synced to all clients. | VERIFIED CODE |
| **H20** | `Vehicle.event.ts:212` | No per-player freeroam vehicle spawn limit — a player can spawn unlimited vehicles, filling the server vehicle pool. | VERIFIED CODE |
| **H21** | `App.tsx:55–67` | `stopAddingHandler()` only logs — does NOT remove handlers. `system:setPage` and `notify:show` handlers accumulate on every component remount (React event leak). | VERIFIED CODE |

---

## Medium Findings (22)

| ID | File(s) | Description | Verified? |
|---|---|---|---|
| **M01** | `ArenaMatch.manager.ts:527–548, 1291–1302` | Double round completion race: `completeRound` called twice simultaneously (zone kill + tick) can double-increment score. No idempotency guard. | VERIFIED CODE |
| **M02** | `ZoneSystem.ts:216–222` | Zone boundary checked with client-reported position (200ms tick) — position spoofing or high latency allows zero zone damage while visually outside the safe zone. | UNVERIFIED AGAINST LIVE DOCS |
| **M03** | `ZoneSystem.ts:428–433` | Zone deaths bypass `logKill` and the native `playerDeath` event — admin kill logs are incomplete for storm-killed players. | VERIFIED CODE |
| **M04** | `ArenaMatch.manager.ts:1211–1244` | All players on the same team spawn at the exact same XYZ coordinate — enemy can memorize and pre-aim the single spawn point. | VERIFIED CODE |
| **M05** | `ArenaSpawn.validation.ts` | Spawn positions not validated against the current zone radius — players can spawn outside the initial 200m safe zone if map preset and zone center diverge. | VERIFIED CODE |
| **M06** | `GunGameMatch.manager.ts:266`, `Death.event.ts:37` | GunGame: simultaneous `playerDeath` + `server:PlayerHit` paths can both call `handleGunGameDeath` before the guard fires — potential double tier advance. | VERIFIED CODE |
| **M07** | `AdminAntiCheat.service.ts:62–65` | Heartbeat anti-cheat nonce uses `Math.random()` — not cryptographically secure; nonce is predictable given `playerId + timestamp`. | VERIFIED CODE |
| **M08** | `Report.manager.ts:73` | Report rate limiting is count-based only (3 open) with no time-based cooldown — player can cycle 3 reports endlessly once staff closes them. | VERIFIED CODE |
| **M09** | `Player.event.ts:244` | Ban expiry uses `parseInt(lifttime)` — `NaN` input (null/malformed) causes `hasDatePassedTimestamp(NaN)` to likely return `false`, converting temporary bans into de-facto permanent bans. | VERIFIED CODE |
| **M10** | Multiple server event files | No `try/catch` on DB calls in on-quit character save, character create, or login — silent unhandled rejection on DB failure. | VERIFIED CODE |
| **M11** | `Auth.event.ts:41` | `loginPlayer` has no "already logged in" guard — player can overwrite their session with a different account without disconnecting. | VERIFIED CODE |
| **M12** | `StatsManager.ts`, `ProgressionManager.ts` | Stats writes (`recordKill`, `recordDeath`, `addXp`) use read-modify-write without atomic increments — kills/deaths/XP are under-counted under concurrent match end events. | VERIFIED CODE |
| **M13** | `WeaponComponentTintSync.module.ts` | Weapon component/tint sync has stream-in race — remote peds can appear without visual attachments until data handler fires; base-36 decode silently discards malformed entries. | UNVERIFIED AGAINST LIVE DOCS |
| **M14** | `Vehicle.class.ts:410–425` | Vehicle mod value `v` is not range-checked — arbitrary integers accepted for all mod indices including invalid ones. | VERIFIED CODE |
| **M15** | `ChatStore.ts:63` (approx.) | `chatStore.messages = []` in `chatAPI.clear()` directly mutates a MobX observable outside an action — throws invariant error in `enforceActions: "always"` mode. | VERIFIED CODE |
| **M16** | `ArenaHud.tsx:74` | `ArenaHud` returns `null` (blank screen) when page is `arena_hud` but both `match` and `matchEnd` are null — no loading/transition state shown to the player. | VERIFIED CODE |
| **M17** | `AdminPanel.tsx:699–724` | Raw `gsap.fromTo()` in 4 `useEffect` blocks with no cleanup return — tweens continue on detached DOM nodes after fast panel dismissal. | VERIFIED CODE |
| **M18** | `Report.tsx:1346`, `AdminPanel.tsx:886` | `window.prompt()` used in staff/admin actions — blocking browser dialog; behavior in RAGE:MP CEF is undefined and may freeze the game thread. | UNVERIFIED AGAINST LIVE DOCS |
| **M19** | `Arena.store.ts` | Arena store does not reset `lobby`, `vitals`, `minimapData` on `matchEnd` or `leftMatch` — stale data from previous match visible at next match start. | VERIFIED CODE |
| **M20** | `Spectate.class.ts:98` | Spectated player disconnect: `Spectate.class.ts` calls remote stop but not `this.stop()` locally — client stays invisible/frozen if server fails to respond. | VERIFIED CODE |
| **M21** | `DamageSync.event.ts:194–197` | Team damage check edge case: if either player has no team assignment (undefined), the `&&` short-circuits and friendly fire is not blocked. | VERIFIED CODE |
| **M22** | `WeaponPresets.service.ts:267–271` | `savePreset` stores raw client-provided component hashes for unrecognized weapons with zero filtering — arbitrary hashes can be persisted to DB and re-applied on spawn. | VERIFIED CODE |

---

## Low Findings (15)

| ID | File(s) | Description | Verified? |
|---|---|---|---|
| **L01** | `Auth.event.ts:17–22` | Legacy SHA-256 unsalted password hashes: accounts that never log in post-migration remain permanently stored with a weak single-pass SHA-256 hash. | VERIFIED CODE |
| **L02** | `Admin.event.ts` | 25 `as any` casts in the most security-critical event handler — worst type safety in the codebase. | VERIFIED CODE |
| **L03** | Client-wide | 34 separate `render` event handlers registered across 30 client files — cumulative per-frame cost on low-end clients; no budget tracking. | VERIFIED CODE |
| **L04** | Various | 40+ production source files contain `console.log` with no `isDev` guard — generates client/server console noise. | VERIFIED CODE |
| **L05** | `gamemode/conf.json` | `fqdn: "eu.loclx.io"` in both `conf.json` files — development tunnel domain left in configuration. | VERIFIED CODE |
| **L06** | `Database.module.ts:54` | No migrations defined — schema changes require manual DDL; `synchronize: beta` is a production foot-gun if `DB_BETA` env var leaks. | VERIFIED CODE |
| **L07** | `Account.entity.ts` | Account deletion does not cascade to characters at the DB level — potential orphaned character rows. | VERIFIED CODE |
| **L08** | `Player.store.ts` | `pincode: 1234` and `wantedLevel: 5` in Player.store — dead RP remnants never removed. | VERIFIED CODE |
| **L09** | `Authentication.tsx:213–256` | "Network Status" sidebar is entirely hardcoded static strings — always shows ONLINE/LIVE regardless of actual server state. | VERIFIED CODE |
| **L10** | `Arena.store.ts:460–483` | `youKill`/`youDied` setTimeout IDs not stored in `_arenaDeathTimeouts` — not cancelled by `flushArenaTransientTimeouts()`; can set stale state on a new match's notification. | VERIFIED CODE |
| **L11** | `Voting.tsx:63` | Voting UI shows blank grid with no message when `voteMaps` is empty — no empty-state fallback. | VERIFIED CODE |
| **L12** | `Player.prototype.ts:83` | `applyHairOverlayToEntity` uses `>> 0` to convert model hashes to signed 32-bit — can produce negative values for large unsigned hashes compared elsewhere. | VERIFIED CODE |
| **L13** | `ArenaHud.tsx:258–276` | Debug sim controls (`<details>`) visible to any player in a solo simulation — no admin gate. | VERIFIED CODE |
| **L14** | `Player.event.ts:30–32`, `Browser.class.ts:210–211` | 5 radar `setTimeout` calls on connect to suppress GTA's radar restoration — indicates the radar init is unreliable without repeated forcing. | VERIFIED CODE |
| **L15** | `Report.event.ts:98–110` | No input length limits enforced on report subject/message or admin action reason fields at the server handler level. | VERIFIED CODE |

---

## Additional Low Findings

| ID | File(s) | Description | Verified? |
|---|---|---|---|
| **L16** | Multiple | 14 `@ts-ignore` suppressions; 6 concentrated in `Player.prototype.ts`. | VERIFIED CODE |
| **L17** | `authPendingBus.ts` | Any server notification resets the Discord OAuth spinner state — a welcome toast can clear an in-progress auth flow's UI indicator. | VERIFIED CODE |

---

## Wiki Verification Summary

| API | Code Usage | Wiki Match | Finding |
|---|---|---|---|
| `mp.players.at(id)` | Used with `remoteId` in `DamageSync.event.ts:172` | Takes pool index, not remoteId | **CRITICAL BUG C01 — wrong player targeted** |
| `mp.players.atRemoteId(id)` | Not used in damage handler | Correct method for remoteId lookup | Missing — needed for C01 fix |
| `mp.gui.cursor.show(bool, bool)` | Both params same value | Second param is `lockedAtCenter` | **HIGH BUG H01 — breaks UI cursor** |
| `BrowserMp.execute(js)` | Event name string-interpolated | Takes raw JS string | Risk: injection via unsanitized interpolation (H02) |
| `mp.browsers.new(url)` | Correct call signature | `(string): BrowserMp` | VERIFIED CORRECT |
| `CameraMp.setActive(bool)` | Correct | `(boolean): void` | VERIFIED CORRECT |
| `mp.game.cam.renderScriptCams(...)` | 6 args | 5–6 args | VERIFIED CORRECT |
| `setInterval(fn, 0)` ×2 | No interval arg / 0ms explicit | Fires at max JS speed | **CRITICAL BUG C02/C03 — CPU spin** |
| `mp.game.gameplay.getGroundZFor3dCoord(...)` | No null check on return | Can return undefined/0 in interiors | **HIGH RISK H09** — UNVERIFIED AGAINST LIVE DOCS |
| `mp.events.addDataHandler(name, cb)` | 2-arg callback | Third arg is oldValue | Fine in JS; no breaking issue |
| `mp.game.network.setInSpectatorMode(bool, handle)` | Correct | `(bool, number): void` | VERIFIED CORRECT |
| `mp.game.cam.setGameplayFollowPedThisUpdate(handle)` | Correct, per frame | `(number): void` | VERIFIED CORRECT |
| `hideHudComponentThisFrame(id)` | Called every frame | Must be called every frame | VERIFIED CORRECT |
| `mp.raycasting.testCapsule(...)` | Missing flags param | Optional flags control entity types | PLAUSIBLE RISK — UNVERIFIED AGAINST LIVE DOCS |
| `PlayerMp.setAlpha(n)` | Correct | `(number): void` | VERIFIED CORRECT |

> **Note:** `wiki.rage.mp` returned HTTP 403 during this audit. RAGE:MP API behavior in this document is based on training data (August 2025 cutoff) and source code pattern analysis. Findings that depend on live API behavior are individually marked UNVERIFIED AGAINST LIVE DOCS.

---

## Runtime Test Checklist

### Auth & Login
- [ ] Connect; skip Discord OAuth; call `server::character:select` with ID `1` — expect: kicked or error, NOT character spawn
- [ ] Connect; complete auth; call `server::auth:loginPlayer` a second time with different credentials — expect: rejected
- [ ] Connect; do not complete auth; trigger `server::chat:sendMessage` — expect: rejected
- [ ] Disconnect mid-Discord-OAuth — expect: no hanging session state

### Damage & Combat
- [ ] Fire at an enemy during the 3-second warmup — expect: **zero damage** (currently broken: warmup fallthrough)
- [ ] Kill a player; continue shooting their corpse — expect: events rejected server-side
- [ ] Use a modified client to send `bone = "Head"` on every shot — confirm headshot multiplier fires in server logs
- [ ] Send `server:PlayerHit` with `victimId = 0` — confirm which player (if any) receives damage
- [ ] Rapid-fire `server:PlayerHit` events beyond weapon RPM — expect: rate-limit kicks in, events rejected

### Match Lifecycle
- [ ] Disconnect during active round; reconnect within 60s — confirm health is NOT restored to full
- [ ] All players on one team disconnect — confirm round ends within 15 seconds
- [ ] Team A reaches win condition AND round timer expires simultaneously — confirm score increments once, not twice
- [ ] Zone damage kills the last player on a team — confirm round end fires correctly

### Admin
- [ ] Non-admin player sends `server::admin:espMode` with mode=1 — expect: rejected
- [ ] Non-admin sends `server::player:noclip` — expect: rejected
- [ ] Server restart — confirm ALL admin audit logs are gone (document as known risk)

### Weapons & Loadout
- [ ] Call `loadout::equipForEdit` with `weaponName = "weapon_railgun"` — expect: blocked (currently not blocked)
- [ ] Save a preset with an invalid component hash — expect: rejected (currently not rejected)
- [ ] Stream in a player with weapon attachments — confirm attachments are visible immediately

### Clothing & Vehicles
- [ ] Submit clothing `drawable = 99999` for component 11 — expect: clamped or rejected (currently not rejected)
- [ ] Rapidly call `tune::spawnVehicleFromWizard` 20 times — expect: limit enforced (currently no limit)
- [ ] Disconnect with a freeroam vehicle spawned — confirm vehicle is cleaned up

### CEF / UI
- [ ] Open chat; paste `<img src=x onerror=alert(1)>` — expect: escaped, not executed
- [ ] Trigger `system:setPage arena_hud` before `arena:setMatch` is sent — confirm blank screen behavior
- [ ] Open report widget; drag off-screen; reload — confirm it is not permanently inaccessible
- [ ] Trigger a notification during Discord OAuth — confirm OAuth spinner does not reset incorrectly
- [ ] Check if vote screen appears blank when `voteMaps` is empty
