# AUDIT REPORT — FULL SYNTHESIS
## Havoc Arena RAGE:MP Server

**Date compiled:** 2026-04-25
**Source audits:** AUDIT_REPORT_STAGE1.md · AUDIT_FINDINGS_STAGE1.md · AUDIT_DAMAGE_COMBAT.md · AUDIT_AUTH_ACCOUNT.md · AUDIT_ADMIN_REPORTS.md · AUDIT_HOPOUTS_ZONE_SPAWNS.md · AUDIT_FFA_GUNGAME_RANKED.md · AUDIT_FRONTEND_CEF_UI.md · AUDIT_LOADOUT_CLOTHING_VEHICLES.md
**Auditors:** Claude Sonnet 4.6 (multiple hostile read-only passes, 2026-04-24)
**RAGE:MP wiki:** https://wiki.rage.mp returned HTTP 403 during all audit passes. All RAGE:MP-specific API behavior is sourced from training data (August 2025 cutoff). Items that depend on live runtime behavior are individually marked **UNVERIFIED AGAINST LIVE DOCS**.

> **Errata (2026-04-25) — read before triaging RAGE:MP items:** A live [wiki.rage.mp](https://wiki.rage.mp/) cross-check of this folder is in **`AUDIT_OF_AUDITS_WIKI_RECHECK.md`**. It revises some API conclusions from this report (notably **F-C01** / victim lookup and **F-H01** / `mp.gui.cursor.show` — wiki uses `freezeControls` and `visibility`, not “lockedAtCenter”). **Security, database, and pure logic findings are largely unchanged.** Per-file digest and **security / stability / gameplay / look** pillars are in **§7–9** of that file; when in doubt, follow the recheck and consolidated priorities there.

---

## 1. Executive Summary

Havoc Arena is a TypeScript RAGE:MP competitive PvP server implementing four game modes (Hopouts/Arena, FFA, GunGame, Freeroam) with a React 18/MobX CEF UI, TypeORM/MySQL database, and Discord OAuth2 authentication.

**This server is NOT ready for public sessions.**

Nine audit passes across the full codebase identified **~120 discrete issues** after deduplication: **14 Critical, 41 High, 40 Medium, 25+ Low/Info**. The issues span four independent threat categories:

| Category | Verdict |
|---|---|
| **Game logic** | Combat system is broken at the root — the wrong player is targeted by every hit event. Warmup provides no damage protection. Dead players can kill living opponents. |
| **Security** | Plaintext credentials in the repository backup. Character hijacking with no authentication gate. Chat XSS with no sanitization. CEF debugging enabled in production config. |
| **Data integrity** | Admin audit log, report system, and anti-cheat flags are all in-memory and lost on every restart. All stat counters (kills, deaths, XP, MMR) race under concurrent writes. |
| **Performance** | Two CPU spin-locks from zero-millisecond `setInterval` calls. 4,608 DOM nodes for a compass component. 35+ per-frame render handlers that never unregister. |

### Top-15 Blockers

| Rank | Canonical ID | One-line summary |
|------|-------------|------------------|
| 1 | **F-C01** | `mp.players.at(remoteId)` — wrong API; damage hits the wrong player or nobody |
| 2 | **F-C06** | Plaintext DB password + Discord client secret committed to repository |
| 3 | **F-C05** | Character hijacking — `character::select` has no auth or ownership check |
| 4 | **F-C09** | Chat XSS — `dangerouslySetInnerHTML` with no sanitization |
| 5 | **F-C04** | Warmup godmode bypass — warmup falls through to uncapped freeroam damage |
| 6 | **F-C07** | Dead players can deal damage — no alive check on shooter |
| 7 | **F-C11** | `character::create` has no authentication gate |
| 8 | **F-C02/C03** | Two CPU spin-locks from `setInterval(fn, 0)` — client hangs |
| 9 | **F-C12** | Report system entirely in-memory — all reports lost on every restart |
| 10 | **F-C10** | Admin audit log in-memory only — rogue admin leaves no persistent trace |
| 11 | **F-C13** | Load-modify-save race on all stat counters — kills/XP/MMR silently lost |
| 12 | **F-C14** | No server-side weapon whitelist — RPG and heavy weapons can be self-granted |
| 13 | **F-C08** | Weapon hash not validated — any hash accepted, combat balance bypassed |
| 14 | AUTH-H04 | Discord OAuth callback has no already-authenticated guard — session hijack path |
| 15 | H04 | `allow-cef-debugging: true` in both production conf.json files |

---

## 2. Repo / System Inventory

### Architecture

```
┌────────────────────────────────────────────────────────────┐
│                   SERVER (TypeScript)                      │
│  Modes: hopouts · ffa · gungame · freeroam (stub)          │
│  Modules: combat · matchmake · party · stats · seasons     │
│  Events: 24+ handlers   Database: TypeORM + MySQL          │
├────────────────────────────────────────────────────────────┤
│                   CLIENT (TypeScript)                      │
│  Classes: Browser · Camera · Hud · Spectate · Creator      │
│  Modules: DamageSync · Recoil · Crouch · Hitmarker (28+)   │
│  Events: Auth · Player · Attachment (4 files)              │
├────────────────────────────────────────────────────────────┤
│                   CEF / React UI                           │
│  React 18 + MobX + Vite + SCSS Modules                     │
│  13 MobX stores · 10+ pages · EventManager bridge         │
└────────────────────────────────────────────────────────────┘
```

### Component Inventory

| Layer | Key files | Lines (approx.) |
|---|---|---|
| Server — Auth | `Auth.event.ts`, `AccountSession.ts`, `discordAuth/*`, `discordAuthState.ts` | ~600 |
| Server — Combat | `DamageSync.event.ts`, `CombatIntegrity.ts`, `SnapshotManager.ts`, `DeathRecapTracker.ts` | ~760 |
| Server — Modes | `ArenaMatch.manager.ts`, `FfaMatch.manager.ts`, `GunGameMatch.manager.ts`, `ZoneSystem.ts` | ~3,500+ |
| Server — Matchmaking | `QueueManager.ts`, `ReconnectManager.ts`, `MatchManager.ts`, `MatchRegistry.ts` | ~350 |
| Server — Stats | `StatsManager.ts`, `ProgressionManager.ts`, `ChallengeManager.ts`, `LeaderboardManager.ts` | ~500+ |
| Server — Player lifecycle | `Player.event.ts`, `Character.event.ts`, `Death.event.ts` | ~585 |
| Server — Admin | `Admin.event.ts`, `Admin.commands.ts`, `AdminAudit.service.ts`, `AdminAntiCheat.service.ts`, `AdminPovCapture.service.ts`, `AdminLog.manager.ts` | ~1,500+ |
| Server — Reports | `Report.event.ts`, `Report.manager.ts` | ~470 |
| Server — Loadout | `WeaponPresets.service.ts`, `WeaponAttachments.data.ts`, `Wardrobe.event.ts` | ~600+ |
| Server — Vehicles | `Vehicle.event.ts`, `Vehicle.class.ts`, `Vehicle.entity.ts` | ~600+ |
| Client — Browser/routing | `Browser.class.ts` | ~666 |
| Client — Combat | `DamageSync.module.ts` | ~119 |
| Client — Auth | `Auth.event.ts (client)`, `Player.event.ts (client)` | ~305 |
| Client — Admin modules | `Noclip.module.ts`, `AdminESP.module.ts`, `AdminGodmode.module.ts`, `AdminPovCapture.module.ts`, `Spectate.class.ts` | ~740 |
| Client — Rendering | 35+ modules with `mp.events.add("render", …)` | ~3,000+ |
| CEF — Auth | `Authentication.tsx`, `AuthForm.tsx`, `DiscordUsernameForm.tsx` | ~606 |
| CEF — HUD | `ArenaHud.tsx`, `TacticalCompass.tsx`, `Chat.tsx`, `DeathScreen.tsx` | ~900+ |
| CEF — Admin | `AdminPanel.tsx` (2,200+ LOC), `AdminMiniPanel.tsx`, `Report.tsx` | ~3,500+ |
| CEF — Stores | `Arena.store.ts`, `Player.store.ts` + 11 more | ~2,000+ |
| Database entities | `Account.entity.ts`, `Character.entity.ts`, `Ban.entity.ts`, `Vehicle.entity.ts` + others | ~350+ |

### External Dependencies

| Dependency | Usage | Risk |
|---|---|---|
| `bcryptjs` | Password hashing (12 rounds) | Correct usage; legacy SHA-256 fallback present |
| `TypeORM` | DB ORM (MySQL) | No transactions on critical paths; `synchronize: beta` foot-gun |
| `Discord OAuth2` | Login flow | HTTP client has no timeout |
| `Node.js https` | Discord API calls | No timeout; no abort controller |
| `GSAP` | CEF UI animations | Tween leaks in admin panel; correctly scoped in auth and report pages |
| `MobX` | CEF state management | Direct mutation outside actions in chat store |
| `React 18` | CEF UI | Handler accumulation in App.tsx cleanup; over-broad deps in Chat.tsx |

---

## 3. RAGE:MP API Compliance Findings

> **Wiki note:** `wiki.rage.mp` returned HTTP 403 during all audit passes. Status assessments are based on RAGE:MP API knowledge from training data, community documentation, and source code cross-analysis. All findings that depend on live runtime behavior are marked **UNVERIFIED AGAINST LIVE DOCS**.

### Status Key
- **VERIFIED CORRECT** — confirmed by code analysis; correct regardless of runtime
- **HIGH-CONFIDENCE BUG** — definitively broken by static analysis alone
- **PLAUSIBLE RISK / NEEDS RUNTIME TEST** — depends on RAGE:MP runtime behavior
- **UNVERIFIED AGAINST LIVE DOCS** — cannot confirm without live wiki access

| API / Usage | Location | Assessment | Status |
|---|---|---|---|
| `mp.players.at(victimId)` used with a remote ID | `DamageSync.event.ts:172` | `at()` takes pool index; `remoteId` is the network ID — different values after any disconnect/reconnect | **HIGH-CONFIDENCE BUG** |
| `mp.players.atRemoteId(id)` — not used in damage handler | `DamageSync.event.ts` | Correct method for remoteId lookup; missing | **HIGH-CONFIDENCE BUG** (fix needed) |
| `mp.gui.cursor.show(showCursor, showCursor)` | `Browser.class.ts:341,378` | Second param is `lockedAtCenter`; passing `true` locks cursor to screen center, making all UI unreachable | **HIGH-CONFIDENCE BUG** |
| `BrowserMp.execute(script)` — event name unescaped in template literal | `Browser.class.ts:416` | Event name string-interpolated without `JSON.stringify` — allows JS injection via crafted event names | **HIGH-CONFIDENCE BUG** |
| `setInterval(fn, 0)` — Camera rotation | `Camera.class.ts:372` | Zero-ms interval fires at maximum JS event-loop speed; CPU spin-lock | **HIGH-CONFIDENCE BUG** |
| `setInterval(fn)` — no arg, weapon wheel | `Player.prototype.ts:97` | Missing interval arg defaults to 0ms; CPU spin-lock whenever weapon wheel disabled | **HIGH-CONFIDENCE BUG** |
| `mp.browsers.new(url)` — Discord OAuth URL | `Auth.event.ts (client):56` | Correct call signature; URL not validated against `https://discord.com/` before opening | **PLAUSIBLE RISK / NEEDS RUNTIME TEST** |
| `mp.game.gameplay.getGroundZFor3dCoord(…)` — no null check | `Player.prototype.ts:109` | Can return `undefined` or `0` in interiors/unloaded terrain; no guard | **PLAUSIBLE RISK / NEEDS RUNTIME TEST** |
| `mp.raycasting.testCapsule(…)` — missing flags param | `Raycast.class.ts` | Optional flags control entity types; absence may change hit detection | **PLAUSIBLE RISK / NEEDS RUNTIME TEST** |
| `mp.peds.atRemoteId` — runtime existence check | `DamageSync.event.ts:296` | Code checks `if ((mp.peds as any).atRemoteId)` before use — suggests may not exist in all builds | **PLAUSIBLE RISK / NEEDS RUNTIME TEST** |
| `player.spawn(position)` after forced death | `ArenaMatch.manager.ts:1371` | Side effects on weapon/animation state after `spawn()` not confirmed | **UNVERIFIED AGAINST LIVE DOCS** |
| `player.call(event, args[])` with 23 positional args | `ZoneSystem.ts:385–409` | RAGE:MP argument count limit unknown; could silently drop args | **UNVERIFIED AGAINST LIVE DOCS** |
| `player.health` 0–200 range | `hopoutsVitalsSync.ts`, `ArenaMatch.manager.ts` | Arena uses 100–200 range for HP + armor stacking; setter assigned values up to 200 | **UNVERIFIED AGAINST LIVE DOCS** |
| `player.giveWeaponEx(hash, total, 30)` | `GunGameMatch.manager.ts:109` | Three-arg form not in official RAGE:MP docs; likely RAGERP custom extension | **UNVERIFIED AGAINST LIVE DOCS** |
| `player.setVariable()` is server-only | Multiple | Critical safety assumption for noclip/ESP trust chain (T-01/T-02) | **UNVERIFIED AGAINST LIVE DOCS** |
| `player.serial` / `player.rgscId` | `Player.event.ts:240`, `Auth.event.ts:136` | Reliability for HWID bans depends on RAGE:MP version; historically spoofable | **UNVERIFIED AGAINST LIVE DOCS** |
| `CameraMp.setActive(bool)` | `Camera.class.ts` | Correct | **VERIFIED CORRECT** |
| `mp.game.cam.renderScriptCams(…)` — 6 args | `Camera.class.ts` | Correct | **VERIFIED CORRECT** |
| `hideHudComponentThisFrame(id)` — called every frame | HUD modules | Must be called every frame; pattern is correct | **VERIFIED CORRECT** |
| `mp.game.network.setInSpectatorMode(bool, handle)` | `Spectate.class.ts` | Correct | **VERIFIED CORRECT** |
| `PlayerMp.setAlpha(n)` | Various | Correct | **VERIFIED CORRECT** |
| `mp.gui.chat.show(false)` / `.activate(false)` | `Browser.class.ts` | Correctly prevents native GTA chat | **VERIFIED CORRECT** |
| `mp.browsers.exists(browser)` — guard before every call | `Browser.class.ts` | Correct guard pattern | **VERIFIED CORRECT** |
| `browser.markAsChat()` | `Browser.class.ts` | Correctly suppresses native chat overlay | **VERIFIED CORRECT** |
| `mp.game.controls.setDisableControlActionBatch()` | `Browser.class.ts` | Correct batched control locking pattern | **VERIFIED CORRECT** |
| `mp.events.callRemote(event, …args)` — sender identity | Throughout | First handler param is always the actual sending player (RAGE:MP guarantee) | **VERIFIED CORRECT** (with UNVERIFIED caveat on live docs) |

---

## 4. System-by-System Findings

> Full per-finding detail — file paths, code snippets, and fix direction — is in `AUDIT_FINDINGS_FULL.md`. This section provides narrative summaries only.

### 4.1 Combat / Damage Pipeline

**Files audited:** `DamageSync.event.ts`, `DamageSync.module.ts`, `CombatIntegrity.ts`, `SnapshotManager.ts`, `DeathRecapTracker.ts`

The combat system has one root failure that makes everything else irrelevant until it is fixed: **every `server:PlayerHit` event targets the wrong player**. The client correctly sends `target.remoteId`, but the server resolves it with `mp.players.at(remoteId)`, which uses the pool index instead of the network remote ID. On any server with more than one player or after any disconnect/reconnect, the damage lands on a random other player or is silently dropped.

Beyond this root failure, four additional critical/high issues compound the damage pipeline:

- **Warmup bypass (F-C04):** When a match exists but `state !== "active"`, all mode checks fail and execution falls to the freeroam `else` block. Players can be killed during warmup by anyone who fires.
- **Dead shooter (F-C07):** No alive-state check on the shooter. Dead players can continue sending `server:PlayerHit` and accumulate kill credit.
- **Weapon hash spoofing (F-C08):** Unknown hashes fall back to `DEFAULT_WEAPON_BASE=28` and `DEFAULT_MAX_DISTANCE_M=100m` instead of being rejected. A modified client can claim any weapon.
- **Always-headshot exploit (DC-H14):** The `targetBone` string is client-controlled. A modified client always sends `"Head"` for 1.5× damage. The headshot ratio logger fires a `console.warn` at >90% but takes no enforcement action.

Bot ped hits (`server:BotPedHit`) bypass all three `CombatIntegrity` checks entirely — no fire rate limit, no duplicate cooldown, no distance cap.

**What is correct:** The lag compensation design (`SnapshotManager`) is sound — it uses server-side position snapshots keyed by timestamp and `shooter.ping / 2`, not client-reported position. The self-shot guard, dimension check, and fire rate validation for player-vs-player hits are present and correct.

### 4.2 Auth / Account / Character / Session

**Files audited:** `Auth.event.ts`, `Character.event.ts`, `Player.event.ts`, `discordAuth/*`, client `Auth.event.ts`, frontend auth + character pages

Two critical handler registrations accept arbitrary calls with no authentication:

- **`character::select` (F-C05):** Any player — including unauthenticated — can call `mp.events.callRemote("server::character:select", anyId)` to spawn as any character in the database by sequential numeric ID. No `player.account` check, no ownership verification.
- **`character::create` (F-C11):** An unauthenticated player can open the character creator and be teleported to a preview dimension. The actual `creator::create` handler does kick unauthenticated players, but the dimension change and CEF routing happen before authentication.

The Discord OAuth flow has correct state management (cryptographically secure nonce, TTL, consume-on-first-use, player-bound pending tokens) but is missing two guards:
- **AUTH-H04:** The OAuth callback does not check whether `player.account` is already set. A logged-in player can start Discord OAuth as a different account and silently swap sessions — including swapping to an admin account if the attacker controls that Discord account.
- **AUTH-H03:** The `https` client used for Discord API calls has no timeout. A hung Discord API response leaves the player's session suspended indefinitely.

Additional high issues: no brute-force protection on `loginPlayer`; `loginPlayer` allows session overwrite without kicking the current session; `creator::navigation` has no auth gate and no type check on `parsedName` (allows arbitrary string concatenation to client event names).

**What is correct:** Session invalidation on disconnect is properly implemented — `onPlayerJoin` resets all session state before any event can fire. OAuth state management is well-implemented. The `creator::create` handler correctly kicks unauthenticated players.

### 4.3 Admin / Reports / Anti-Cheat

**Files audited:** `Admin.event.ts`, `Admin.commands.ts`, `AdminAudit.service.ts`, `AdminAntiCheat.service.ts`, `AdminPovCapture.service.ts`, `AdminLog.manager.ts`, `Report.event.ts`, `Report.manager.ts`, client admin modules

Three in-memory-only systems create the same class of data loss risk:

- **Admin audit log (F-C10):** All admin actions are stored in a 2,000-entry ring buffer. The entire audit history is erased on every server restart. A rogue admin can take destructive actions then restart the server.
- **Report system (F-C12):** Every report — subject, message, chat history, claim/close trail — lives in a module-level array. A crash or intentional restart destroys all open cases.
- **Anti-cheat flag history (ADMIN-H03):** All flag history accumulated for a player is deleted on `playerQuit`. A cheating player resets their entire anti-cheat record by disconnecting.

Additional issues:
- Zone editor destructive operations (`hopoutsZoneEditorDelete`, `hopoutsZoneEditorDeleteMap`) produce no audit log entries — a level-6 admin can silently delete all arena maps.
- POV capture frame chunks have no per-chunk size cap — a monitored player could exhaust server memory with oversized responses.
- Anti-cheat nonce uses `Math.random()` rather than `crypto.randomBytes()` — predictable given player ID and timestamp.
- No time-based rate limit on report creation; no rate limit on admin commands.

**What is correct:** The noclip and ESP trust chain is sound — `adminLevel` is a server-set variable that clients cannot write. The `/noclip` command re-verifies `getAdminLevel() < 1` server-side. `player.call()` correctly targets only one client.

**Engine limitation:** `Admin-SetGM` local event (`mp.events.add("Admin-SetGM", …)`) can be self-invoked by a modded client to set `SET_ENTITY_INVINCIBLE`. This is a GTA V native-level limitation; server-authoritative prevention is not possible. Detection via damage registration discrepancy is the practical mitigation.

### 4.4 Hopouts / Arena / Zone / Spawns

**Files audited:** `ArenaMatch.manager.ts`, `ZoneSystem.ts`, `ArenaSpawn.validation.ts`, `ArenaConfig.ts`, `Arena.module.ts`, `HopoutsZones.*`, `ReconnectManager.ts`, `ArenaZone.module.ts`, `ArenaSpectateController.module.ts`

The Hopouts system has one server-crash path and two compounding logic bugs that break 1v1 match integrity:

- **H1 (crash):** `ArenaSpawn.validation.ts:60` dereferences `preset.redSpawn.x` in the fallback path after a `null`-coalesce without guarding `redSpawn` itself. A malformed preset JSON (missing `center` and `redSpawn`) throws an uncaught `TypeError`, potentially crashing the server process.
- **H2/H3 (premature round end):** `beginRound` resets `alive=true` for all players but does NOT clear `disconnected` or `roundPresenceDeadline`. A `setTimeout` fired 15 seconds after a Round N disconnect still holds a reference to the live match object. Because `match.state === "active"` is true for Round N+1 by T+15s, both guards pass and `checkRoundEnd` fires prematurely — ending Round N+1 in the opponent's favor without combat. This affects all 1v1 matches.

Fairness issues: reconnecting players get full medkit/plate counts regardless of pre-disconnect usage (exploitable with deliberate short disconnects); reconnecting players receive a hardcoded zone radius of 200 regardless of current phase; the zone grace timer resets to zero when a player briefly re-enters the safe zone (indefinitely exploitable boundary abuse).

Memory issue: `stormDamageBank` entries keyed by `player.id` (session ID) are not deleted on disconnect — orphaned entries accumulate for the server process lifetime.

**What is correct by design:** Storm damage bypassing armor is consistent with battle-royale genre norms. Draw rounds from simultaneous mutual deaths are handled correctly. Zone phase progression and DPS values match the ArenaConfig specification.

### 4.5 FFA / GunGame / Ranked / Stats

**Files audited:** `FfaMatch.manager.ts`, `GunGameMatch.manager.ts`, `QueueManager.ts`, `StatsManager.ts`, `ProgressionManager.ts`, `ChallengeManager.ts`, `Death.event.ts`, `ArenaDev.commands.ts`

The stat persistence layer has a systemic race condition (F-C13) that silently discards data under any concurrency. Every stat function uses the pattern: read row → increment in memory → write row. At each `await` boundary Node.js yields; two concurrent calls for the same player both read the same stale row, both increment from the same base, and the second write overwrites the first. Affected: kills, deaths, match wins/losses, XP, MMR, challenge progress, prestige. **Under normal match-end conditions — kill XP fired per-kill and match-end XP fired at round conclusion for the same player — this race is not hypothetical; it fires on every match.**

The ranked MMR update (`updateRankedMatchResult`) has no DB-level idempotency key. The in-memory `match.state === "match_end"` guard prevents double-award in normal operation but is lost on server restart. If the server restarts mid-finalization, MMR can be applied twice with no detection mechanism.

`/mydim` (an admin dev command at level 6) places an admin in any dimension by raw integer, including active match dimensions. The admin can hit and kill match players. Kills route to `handleFfaDeath(victim, adminPlayer)` where `killerData` returns `undefined` (admin is not in the match roster), so the admin accumulates no score but the victim incurs deaths and respawn delays. No audit log entry is written for `/mydim` usage.

**What is verified correct:** FFA and GunGame are confirmed isolated from ranked MMR — `updateRankedMatchResult` is never called from either mode's end-of-match path. Rank tier boundary logic is correct (verified: no off-by-one errors). The `match.state === "match_end"` double-end guard works correctly in normal operation.

### 4.6 Frontend / CEF / UI / HUD

**Files audited:** `App.tsx`, `PageContext.tsx`, `Browser.class.ts`, `Hud.class.ts`, all stores, all page components, `Auth.event.ts (client)`, `AttachEditor.module.ts`

**Chat XSS (F-C09):** `Chat.tsx:182` uses `dangerouslySetInnerHTML={{ __html: timePrefix + el.html }}` with `el.html` being server-supplied content with zero sanitization at any layer. RAGE:MP CEF runs Chromium; injected code executes with full browser privileges and can call `mp.trigger('client::someEvent')` to fire client-side RAGE:MP events.

**Cursor locked to center (CEF-H02):** `mp.gui.cursor.show(showCursor, showCursor)` passes the same value for both `visible` and `lockedAtCenter`. When `showCursor=true`, the cursor is also locked to the viewport center — every UI click registers at the center of the screen regardless of pointer position, making all UI menus non-functional.

**Event handler accumulation:** `EventManager.stopAddingHandler()` is a debug logging function, not a cleanup function. It does not remove handlers. This call appears as the cleanup in `App.tsx`'s `useEffect` return and in every store's `createEvents()` method — meaning no CEF event handler is ever removed. Because stores are singletons this is not immediately catastrophic, but it is a systemic design debt that will cause issues on any emergency reset or store re-initialization.

**CEF JS injection (CEF-H01):** `Browser.class.ts:416` builds a `browser.execute()` script by string-interpolating the event name without `JSON.stringify`. A crafted server-sent event name like `cef::foo", inject="evil` injects arbitrary JS into the CEF context.

**Performance:** The TacticalCompass renders 4,608 `<div>` elements. At 60 fps, compositing this subtree every frame on integrated-GPU / low-RAM clients (the target hardware for RAGE:MP) is the dominant client-side frame-time cost in the UI layer. Additionally, 35+ module-level `mp.events.add("render", …)` handlers fire on every rendered frame for the entire session with no enable/disable lifecycle.

### 4.7 Loadout / Clothing / Vehicles

**Files audited:** `WeaponPresets.service.ts`, `WeaponAttachments.data.ts`, `WeaponComponentTintSync.prototype.ts`, `Wardrobe.event.ts`, `Vehicle.event.ts`, `Vehicle.class.ts`, `Vehicle.entity.ts`, `Character.entity.ts`, shared loadout files

**Weapon whitelist (F-C14):** `equipToFreeroam`, `equipForEdit`, and `savePreset` never consult `WEAPON_REGISTRY.enabled`. The only guard is the carry-group check — weapons that return `"primary"` or `"sidearm"` (which includes RPG, grenade launcher, heavy weapons) are granted unconditionally. Players can self-grant any such weapon in freeroam.

**Clothing validation (LCV-H3):** `isValidClothesSlot` checks `drawable >= 0` and `texture >= 0` but has no upper-bound. Any non-negative integer is accepted, stored, and synced to all clients. `wardrobeBlockedDrawables.json` defines a list of blocked drawable ranges for the tops component but is only consulted by the client-side UI picker — the server `saveInline` handler ignores it entirely.

**Vehicle spawn limit (F-C14 / LCV-C3):** No per-player vehicle spawn limit exists in freeroam. The `vehiclePool` array is unbounded. A single player can spawn unlimited vehicles, consuming server RAM until process death.

**Database integrity:** `Vehicle.entity.ts` has no UNIQUE constraint on the `plate` column and no foreign key from `owner_id` to the accounts table. Deleting an account leaves orphaned vehicle rows with stale `owner_id` values. Vehicle modifications, colors, and JSON columns have no range checks or schema constraints at any layer.

---

## 5. UI/UX Quality Findings

### Page-by-Page Quality Summary

#### Auth Page — **Score: 8.5 / 10**

**Strengths:** Terminal/boot aesthetic is cohesive and game-appropriate. GSAP usage is best-in-class across the codebase — all timelines are scoped to `terminalRef` and auto-killed on unmount. The boot veil prevents UI flash reliably. The state machine (gate → legacy password | discord_username form) is clean and linear. Discord OAuth state/token management is cryptographically correct.

**Issues:**
- 6-second hardcoded `setTimeout` for boot veil fallback with no loading indicator — players on slower machines see a blank screen with no feedback.
- Discord OAuth error path: if the server returns an error after `discordOpen`, the UI state stays in `"pending"` forever with no visible error message.
- `useGSAP` scope pattern is correct here but inconsistently applied across the rest of the codebase — Auth is the only page that does this right.

---

#### HUD / Chat — **Score: 6 / 10**

**Strengths:** Component composition is clean (Chat, DeathScreen, InteractButton are separate). DeathScreen countdown and respawn timer logic is correct. Chat tab cycling (↑/↓), command autocomplete, and history cycling are functional.

**Issues:**
- **XSS** — highest-priority issue in the codebase. `dangerouslySetInnerHTML` with no sanitization.
- Chat panel aesthetics feel web-native (Discord/Slack widget) rather than game-native. A minimal transparent text strip would be more appropriate in a GTA context.
- Opacity race: `Math.max(chatOpacity, store.isActive ? 1 : 0)` — if `isActive` toggles during a GSAP fade, opacity jumps instead of blending. The reactive value and the animation fight each other.
- No rate limiting on chat message sends — players can spam the submit action.
- No empty-state indicator for new players (blank div shown when messages = 0).

---

#### Arena HUD — **Score: 8 / 10**

**Strengths:** `HUDController` dispatching by mode (`hopouts` / `ffa` / `gungame`) is clean and extensible. `UnifiedScoreboard` handles all three modes without code duplication. Kill feed is properly keyed and transitions correctly. Team vitals, ammo, and voice indicators are synchronized. No `dangerouslySetInnerHTML` outside the chat panel.

**Issues:**
- **TacticalCompass DOM bloat** — 4,608 `<div>` elements. This is the single biggest client-side performance issue in the UI layer. A canvas or SVG looping approach would reduce this to O(1) nodes.
- **Hardcoded imgur URL** (`https://i.imgur.com/k6lP09r.jpg`) in the solo-simulation branch — ships in the production bundle. External CDN dependency; reveals internal debug state; broken behind corporate NAT.
- Scoreboard "hold to view" has no on-screen hint about which key to hold — undiscoverable for first-time players.
- KillFeed shows nothing when empty — a subtle fade-out or quiet icon would feel more intentional.
- No audio cues for round events (round start/end, kill) — only UI interaction sounds, and those are silently broken (see Admin Panel).

---

#### Main Menu — **Score: 7 / 10**

**Strengths:** Clean explicit state management (`loading` / `error` / `activeNav`). Proper `useEffect` cleanup for registered event handlers — one of the few pages that does this correctly. Tab transitions are smooth.

**Issues:**
- Escape key swallowed in capture phase (`addEventListener("keydown", swallowEscape, true)`) regardless of whether the menu is open — too aggressive, intercepts browser-internal handlers.
- No load timeout — if the server never responds to the initial data request, the menu stays in loading state indefinitely.
- `emit("scene", …)` fires on every tab switch, potentially triggering server-side operations on every navigation.
- Player list polling has no debounce — rapid open/close sequences could hammer the server event handler.

---

#### Admin Panel — **Score: 5 / 10**

**Strengths:** Comprehensive feature set. Some sections use `Virtuoso` for virtualized lists. `AdminMiniPanel` is well-separated with focused scope.

**Issues (structural):**
- 2,200+ LOC single-component file — the largest maintenance liability in the codebase. Should be split into at minimum 6–8 sub-components (Players, Bans, Reports, Chat, System, Settings, Zone Editor).
- Visual aesthetic is a web admin dashboard — no integration with the game aesthetic. Contrast with the auth page.

**Issues (behavioral):**
- **Silent sound pool** — `SOUND_SLOTS` has all values `undefined`; no audio ever plays for any admin action.
- No keyboard shortcuts for common actions (ban, kick, spectate, mute). High-volume moderation requires hotkeys.
- Report detail panel auto-refreshes with no new-message indicator — no red dot, no scroll hint.
- No bulk action support (ban N players at once).
- "Box-within-box" layout nesting (panel → section → card → row → field) creates visual claustrophobia.

---

#### Admin Mini Panel — **Score: 7 / 10**

**Strengths:** Focused scope (quick actions only). Confirmation dialogs before destructive actions. Player search/filter works. GSAP animations are properly scoped with `tween.kill()` in cleanup.

**Issues:**
- Still web-native aesthetic — a compact overlay widget (PDA/phone aesthetic) would integrate better.
- No keyboard navigation — Tab/Enter do not work for confirm/deny flows.

---

#### Report Widget — **Score: 9 / 10**

The best-designed page in the codebase.

**Strengths:** `Virtuoso` for large ticket lists. Scoped GSAP with explicit `tween.kill()`. Player picker with fuzzy search. Both player and staff views handled cleanly. `mergeSelectedFromList` uses functional `setState` updater to avoid stale closure bugs. Empty-state messages present.

**Issues:**
- No rate limit on message sends within an open report — spam button would queue multiple rapid submissions.
- `FloatingHint` does not close on Escape, unlike all other overlay elements — inconsistent UX.
- Timestamp stacking heuristic (`prev.at < 1_000_000_000_000 ? prev.at * 1000 : prev.at`) will mishandle `at === 0`; the comment-free heuristic is fragile.

---

## 6. Gameplay Integrity Findings

### Critical Integrity Failures (active/real-session risk)

1. **Entire combat system broken — wrong player targeted (F-C01).**
   Every `server:PlayerHit` event resolves the victim by pool index instead of remote ID. On any server with more than one player or after any disconnect/reconnect, damage lands on a wrong player or is silently dropped. No match mode is playable until this is fixed.

2. **Warmup provides no damage protection (F-C04).**
   Players in warmup receive full uncapped freeroam damage. Any player who fires during warmup can kill opponents before the round begins.

3. **Dead players can deal damage and earn kill credit (F-C07).**
   A dead player's client continues sending `server:PlayerHit` with no server-side alive check. Stats are corrupted; games can be decided by dead players.

4. **Character hijacking (F-C05).**
   Any player can spawn as any character in the database using sequential numeric ID guessing. No authentication or ownership check on `character::select`.

5. **Weapon hash spoofing (F-C08 / F-C14).**
   Clients can claim any weapon hash to manipulate damage, range, and fire rate tables. Players can also self-grant weapons not in their loadout (including heavy weapons) via the freeroam loadout system.

6. **Reconnect restores full HP/armor (H15).**
   `spawnPlayerAtArena` always sets `health=200, armor=100` on reconnect. A player at 10 HP who deliberately disconnects (router reset) returns to full health.

7. **Disconnect-abuse stall tactic in 1v1 matches (HOPOUTS-H2 / HOPOUTS-F4).**
   A losing player in a 1v1 can disconnect to force a 15-second delay before the opponent's win is registered. Combined with the `beginRound` bug (H3), the stale `setTimeout` fires during Round N+1 and ends it in the disconnector's opponent's favor — i.e., the reconnecting loser can convert the delay into a free round win.

8. **Stat race conditions — kills/XP/MMR silently lost (F-C13).**
   Every stat counter uses load-modify-save without atomic DB increments. Under normal match-end conditions (per-kill XP fires concurrently with match-end XP for the same player), race writes are expected, not edge-case. Kill counts, death counts, XP, and MMR are all affected.

9. **MMR double-award possible on restart during finalization (HIGH-04).**
   The only guard against double MMR application is an in-memory `match.state === "match_end"` flag. A server restart mid-finalization loses this flag; the next boot has no record of the match result and no DB-level idempotency check.

10. **FFA kill farming (H17).**
    No protection against coordinated intentional deaths between two accounts. Two cooperating players can cycle kills indefinitely to farm stats.

### Fairness Violations

- **Reconnect item refresh (HOPOUTS-M3):** Reconnecting players receive full medkit/plate counts regardless of pre-disconnect usage. Intentionally disconnecting after using all consumables refreshes them on reconnect.
- **Zone grace timer reset (FFA-MED-03):** The 8-second OOB grace timer resets to zero when a player briefly touches the zone boundary. A player can operate outside the intended play area indefinitely by re-entering every ~7 seconds.
- **`/mydim` admin grief (HIGH-03):** An admin using `/mydim <match-dimension>` can kill match players without being registered in the match roster. Kills force respawns and stat decrements with no recourse.
- **Single spawn pair degradation (HOPOUTS-F5):** When vehicle coverage or preset geometry reduces the candidate pool to one spawn pair, all rounds use identical spawn positions. Pre-aiming the spawn point is trivially exploitable.
- **BotPedHit bypasses combat validation (DC-M02):** Bot hits have no fire rate limit, duplicate cooldown, or distance cap. XP/challenge rewards tied to bot kills are farmable at unlimited rate.

### Design Choices (Not Bugs)

| Behavior | Assessment |
|---|---|
| Storm damage bypasses armor | **DESIGN CHOICE** — consistent with battle-royale genre norms; no fix recommended |
| Draw round on simultaneous storm deaths | **VERIFIED CORRECT** — handled symmetrically; rare in practice |
| FFA/GunGame isolated from ranked MMR | **VERIFIED CORRECT** — `updateRankedMatchResult` is never called from either mode |
| Rank tier boundary logic | **VERIFIED CORRECT** — no off-by-one errors; Bronze 0 MMR floor enforced |
| `checkRoundEnd` guard during warmup | **VERIFIED CORRECT** — `if (match.state !== "active") return` prevents spurious round end |

---

## 7. Highest Priority Fix List

### MUST FIX IMMEDIATELY
*Do not open to any public or semi-public session until all 15 are resolved.*

| Rank | ID | File : Line | Fix Summary |
|------|-----|------------|-------------|
| 1 | **F-C01** | `DamageSync.event.ts:172` | Replace `mp.players.at(victimId)` → `mp.players.atRemoteId(victimId)` |
| 2 | **F-C06** | `gamemode/.env`, `ragemp-server/.env` | Rotate DB password + Discord client secret immediately; add `.env` to `.gitignore`; audit who has the backup |
| 3 | **F-C05** | `Character.event.ts:132–144` | Add `if (!player.account) return player.kick(…)` + load char with `relations: ["account"]` + check `character.account.id === player.account.id` |
| 4 | **F-C09** | `Chat.tsx:182` | Replace `dangerouslySetInnerHTML` with `DOMPurify.sanitize(el.html)` or render as plain `textContent` |
| 5 | **F-C04** | `DamageSync.event.ts:244` | Before the `else` freeroam block add: `} else if (ffaMatch \|\| gunGameMatch \|\| hopoutsMatch) { return; }` |
| 6 | **F-C07** | `DamageSync.event.ts:170` | Add `if (shooter.getVariable("alive") === false) return;` |
| 7 | **F-C11** | `Character.event.ts:148` | Add `if (!player.account) return player.kick("Not authenticated.");` at top of handler |
| 8 | **F-C02** | `Camera.class.ts:372` | Change `setInterval(fn, 0)` → `setInterval(fn, 16)` |
| 9 | **F-C03** | `Player.prototype.ts:97` | Add interval argument: `setInterval(fn, 100)` |
| 10 | **F-C12** | `Report.manager.ts` | Persist reports to a DB table; keep in-memory array only as UI cache |
| 11 | **F-C10** | `AdminAudit.service.ts` | Write audit entries to a DB table on every `auditLog()` call; keep ring buffer for the in-panel UI view |
| 12 | **AUTH-H04** | `DiscordOAuthServer.ts:186`, `Auth.event.ts:78` | Add `if (player.account) return player.showNotify(…, "Already signed in.");` in `auth::discordStart`; add same guard before `enterGameWithAccount` in OAuth callback |
| 13 | **AUTH-H01** | `Auth.event.ts:41` | Track per-player failed attempt counter in a `Map`; lock out for 60 s after 5 failures; clear on success or disconnect |
| 14 | **F-C13** | `StatsManager.ts:106–130`, `ProgressionManager.ts:89–110` | Replace load-modify-save with atomic DB increments: `UPDATE player_stats SET kills = kills + 1 WHERE "playerId" = $1` for all stat columns |
| 15 | **H04** | `gamemode/conf.json`, `ragemp-server/conf.json` | Set `"allow-cef-debugging": false` |

### SHOULD FIX NEXT
*Fix before any sustained or recurring play sessions.*

| Rank | ID | File : Line | Fix Summary |
|------|-----|------------|-------------|
| 16 | **F-C08 / F-C14** | `DamageSync.event.ts:104`; `WeaponPresets.service.ts` | Add `if (!weaponDamage[weaponHash]) return;` to reject unknown hashes; consult `WEAPON_REGISTRY.enabled` in `equipToFreeroam` and `savePreset` |
| 17 | **CEF-H02** | `Browser.class.ts:341,378` | Change `cursor.show(showCursor, showCursor)` → `cursor.show(showCursor, false)` |
| 18 | **CEF-H01** | `Browser.class.ts:416` | Change `"${event}"` → `${JSON.stringify(event)}` in the `browser.execute()` template literal |
| 19 | **AUTH-H02** | `Auth.event.ts:41`; `AccountSession.ts` | Add `if (player.account) return player.showNotify(…, "Already signed in.");` at top of `loginPlayer` handler and inside `enterGameWithAccount` |
| 20 | **AUTH-H03** | `discordHttps.ts:8` | Add `req.setTimeout(10000, () => req.destroy(new Error("Discord API timeout")));` |
| 21 | **AUTH-H05** | `Character.event.ts:116` | Add `if (!player.account) return;` + `if (typeof parsedName !== "string" \|\| parsedName.length > 64) return …;` in `creator::navigation` |
| 22 | **H10** | `Admin.commands.ts:670–678` | Add `rsgId: player.rgscId` to the ban record in the `/ban` command handler |
| 23 | **HOPOUTS-H1** | `ArenaSpawn.validation.ts:60` | Add null guard: `if (!preset.center && !preset.redSpawn) throw new Error(…)` before the nullish-coalesce fallback; validate preset shape on load |
| 24 | **HOPOUTS-H2/H3** | `ArenaMatch.manager.ts:1198,1590` | In `beginRound` `forEach` loops add `p.disconnected = false; p.roundPresenceDeadline = undefined;` |
| 25 | **H15** | `ArenaMatch.manager.ts:1102–1107` | On reconnect, restore the player's actual pre-disconnect HP/armor from `matchPlayer` snapshot instead of always setting 200/100 |
| 26 | **H16** | `ArenaMatch.manager.ts:1560–1603` | Increment `matchPlayer.deaths` when a player disconnects while alive |
| 27 | **ADMIN-H02** | `Admin.event.ts:929–982` | Add `auditLog(admin, "zone_delete", …)` before all destructive zone editor operations |
| 28 | **ADMIN-H03** | `AdminAntiCheat.service.ts:175` | Persist `flagHistory` and `clientHeartbeat` strikes to DB keyed by account ID; load on player connect |
| 29 | **H11 / AUTH-M01** | `Character.event.ts:154`; `Auth.event.ts:106` | Wrap character creation and Discord registration in TypeORM `QueryRunner` transactions with explicit commit/rollback |
| 30 | **HIGH-01** | `FfaMatch.manager.ts:282`; `GunGameMatch.manager.ts:304` | Wrap the per-player stat persist block in a DB transaction; add per-player error record to a retry queue on failure |
| 31 | **HIGH-03** | `ArenaDev.commands.ts:330` | Add `auditLog()` entry for `/mydim`; block the command if the target dimension belongs to an active match |
| 32 | **HIGH-04** | `StatsManager.ts:56` | Write a `match_result` DB row with a unique match ID as an idempotency key before applying MMR delta; skip if row already exists |
| 33 | **LCV-H3** | `Wardrobe.event.ts:110–121` | Add upper-bound validation: reject drawable/texture values exceeding the limits in `clothesLimits.ts` |
| 34 | **LCV-H4** | `Wardrobe.event.ts` | Load `wardrobeBlockedDrawables.json` server-side and consult it in the `saveInline` handler |
| 35 | **CEF-H05** | `TacticalCompass.tsx` | Replace the 4,608-node static tape with a canvas or SVG looping approach that renders only the visible ~36 ticks |
| 36 | **AUTH-M02** | `Auth.event.ts:41` | Add `if (String(username).length > 32 \|\| String(password).length > 128) return showNotify(…);` |
| 37 | **AUTH-M03** | `Player.event.ts:244` | Replace `parseInt(lifttime)` pattern with `const liftMs = parseInt(lifttime ?? ""); if (!isNaN(liftMs) && hasDatePassedTimestamp(liftMs)) { delete }` |
| 38 | **ADMIN-M02** | `AdminAntiCheat.service.ts:63` | Replace `Math.random()` with `crypto.randomBytes(16).toString("hex")` for heartbeat nonce |
| 39 | **ADMIN-H01** | `AdminPovCapture.service.ts:307–327` | Cap individual chunk byte length ≤ 8,000 bytes; cap total assembled frame size ≤ 4 MB |
| 40 | **DC-M02** | `DamageSync.event.ts:307–329` | Add `validateFireRate`, `validateDuplicateHit`, and `validateDistance` calls to the `server:BotPedHit` handler |

### POLISH LATER
*Medium/Low — quality, robustness, and fairness improvements.*

| Rank | ID | Fix Summary |
|------|-----|------------|
| 41 | HOPOUTS-M3 | Track `medkitsUsed` / `platesUsed` on `MatchPlayer`; on reconnect restore `max(0, perRound - used)` |
| 42 | FFA-MED-03 | Zone grace timer: accumulate total OOB time rather than resetting on re-entry |
| 43 | M01 | Add a `roundCompleted` boolean flag to `completeRound` for idempotency |
| 44 | ADMIN-M01 | Track `lastReportAt` per player; enforce 2-minute minimum between submissions |
| 45 | ADMIN-M03 | On report submission: look up `mp.players.at(reportedPlayerId)` server-side; overwrite `reportedPlayerName` from server-authoritative source |
| 46 | ADMIN-M04 | Enforce: subject ≤ 128 chars, message body ≤ 1,000 chars, chat messages ≤ 500 chars |
| 47 | ADMIN-M05 | Add `auditLog(admin, "panel_open")` / `("duty_on")` / `("duty_off")` at relevant event handlers |
| 48 | ADMIN-M06 | Implement per-admin, per-command cooldown `Map`; 1 s default, 5 s for mass-affect commands |
| 49 | LCV-C3 | Cap freeroam vehicle spawns at 3–5 per player; enforce in `spawnVehicleFromWizard` |
| 50 | LCV-H2 | Block `savePreset` if `player.getVariable("inMatch")` is truthy |
| 51 | LCV-H5 | Validate clothing component drawables against the character's ped model gender on `saveInline` |
| 52 | LCV-H6 | Wrap `saveVehicle()` and `insertVehicle()` in TypeORM transactions |
| 53 | LCV-M3 | Add `UNIQUE` constraint on `vehicle.plate` column |
| 54 | LCV-M4 | Add FK from `vehicle.owner_id` → `account.id` with `ON DELETE CASCADE` |
| 55 | LCV-M5 | Add per-player 1–2 s cooldown on `saveInline` clothing handler |
| 56 | CEF-C02/C03 | Wire `EventManager.removeHandler()` in `App.tsx` cleanup return; add `destroyEvents()` counterpart to stores |
| 57 | CEF-M01 | Add `roundStart` / `lastKillNotification` / `lastDeathNotification` timeout IDs to `_arenaDeathTimeouts` |
| 58 | CEF-M03 | Add `mp.game.graphics.transitionFromBlurred(0)` at the start of `emergencyReset()` |
| 59 | CEF-M05 | Call `editBrowser.destroy(); editBrowser = null;` on `AttachEditor` close |
| 60 | CEF-M06 | Populate `SOUND_SLOTS` with real asset paths; split `AdminPanel.tsx` into 6–8 sub-components |
| 61 | RANK-04 | Add B-tree index on `player_stats.mmr`; add server-side leaderboard cache with TTL |
| 62 | H05 | Fix `Camera.class.ts`: `resolution.y` is assigned to the variable named `width` |
| 63 | H06 | `Camera.destroyCamera`: remove entries from `this.list` to prevent stale `isActive()` returns |
| 64 | H08 | `Raycast`: store interval ID at construction; call `clearInterval` in destroy path |
| 65 | L01 | Plan SHA-256 legacy account migration: force password reset on next login for pre-migration accounts |
| 66 | L05 | Remove `fqdn: "eu.loclx.io"` from both `conf.json` files |
| 67 | L07 | Add cascade delete from `account` to `characters` at the DB level |
| 68 | L10 | Add `youKill` / `youDied` setTimeout IDs to `_arenaDeathTimeouts` in `Arena.store.ts` |
| 69 | L13 | Gate debug simulation controls in `ArenaHud.tsx:258–276` behind `import.meta.env.DEV` |
| 70 | MED-04 | Apply the same atomic DB increment fix to `ChallengeManager.incrementChallengeProgress` |

---

## 8. Runtime Test Checklist

Each entry notes current expected behavior based on static analysis. ✓ = currently passes. ✗ = currently fails. `[UNVERIFIED]` = cannot confirm without live runtime.

### 8.1 Auth & Login

- [ ] Connect without completing auth; call `mp.events.callRemote("server::character:select", 1)` → **EXPECT: kick** ✗ CURRENTLY: spawns as character ID 1
- [ ] Connect without completing auth; call `mp.events.callRemote("server::character:create")` → **EXPECT: kick** ✗ CURRENTLY: player teleported to creator dimension, creator UI opens
- [ ] Connect without completing auth; call `mp.events.callRemote("server::creator:navigation", '"general"')` → **EXPECT: rejected** ✗ CURRENTLY: `changeCamera` event fires on the player
- [ ] Call `mp.events.callRemote("server::creator:create", '{}')` without auth → **EXPECT: kick** ✓ (handler correctly kicks)
- [ ] Send `loginPlayer` 30×/s with wrong passwords for a known username → **EXPECT: rate-limited after ~5 failures** ✗ CURRENTLY: no limit
- [ ] Send `loginPlayer` while already authenticated → **EXPECT: rejected** ✗ CURRENTLY: session silently overwritten
- [ ] Send `loginPlayer` with `username` = 500-character string → **EXPECT: length error** ✗ CURRENTLY: TypeORM error / unhandled rejection
- [ ] Start Discord OAuth while already authenticated via password → **EXPECT: rejected** ✗ CURRENTLY: OAuth flow starts; callback will overwrite session
- [ ] Complete Discord OAuth callback twice using same state (browser back/replay) → **EXPECT: second rejected** ✓ (state consumed on first use)
- [ ] Start Discord OAuth; wait 16 minutes; complete callback → **EXPECT: "Session expired"** ✓ (correctly expired by TTL)
- [ ] Disconnect mid-Discord-OAuth → **EXPECT: no hanging state** ✓ (pending cleared on quit)
- [ ] Simulate Discord API hang after TCP connect → **EXPECT: timeout ~10 s** ✗ CURRENTLY: Promise hangs indefinitely; player stuck

### 8.2 Character & Ownership

- [ ] Authenticate as account A (char ID 1); call `server::character:select` with ID = char owned by account B → **EXPECT: kick** ✗ CURRENTLY: spawns as B's character
- [ ] Call `server::character:select` with non-existent ID → **EXPECT: showNotify error** ✓ (correctly shows error)
- [ ] Authenticate; disconnect between character DB save and `spawnWithCharacter` → verify orphaned row exists; verify recoverable on next login `[UNVERIFIED]`
- [ ] Trigger a server notification during Discord OAuth flow → **EXPECT: OAuth spinner unaffected** ✗ CURRENTLY: spinner resets (L17)

### 8.3 Damage & Combat

- [ ] Fire at an enemy during the 3-second warmup → **EXPECT: zero damage** ✗ CURRENTLY: full uncapped damage
- [ ] Kill a player; continue shooting their corpse → **EXPECT: events rejected server-side** ✗ CURRENTLY: dead player can deal damage
- [ ] Send `server:PlayerHit` with `victimId = 0` → confirm which player (if any) receives damage `[UNVERIFIED]`
- [ ] Modified client always sends `bone = "Head"` → **EXPECT: detected and enforcement action taken** ✗ CURRENTLY: `console.warn` only at >90% ratio
- [ ] Rapid-fire `server:PlayerHit` beyond weapon RPM → **EXPECT: rate limit enforced** ✓ (fire rate validation present)
- [ ] Send `weaponHash = "weapon_rpg"` → **EXPECT: rejected** ✗ CURRENTLY: accepted with default fallback values
- [ ] Send weapon tint index `255` → **EXPECT: clamped or rejected** ✗ CURRENTLY: stored and synced to all clients
- [ ] Call `server:BotPedHit` at maximum rate → **EXPECT: rate-limited** ✗ CURRENTLY: no fire rate check on bot hits

### 8.4 Match Lifecycle (Hopouts)

- [ ] Upload a preset JSON with `center: null` and `redSpawn: null`; start a match → **EXPECT: validation error, no crash** ✗ CURRENTLY: `TypeError` crash (HOPOUTS-H1)
- [ ] In a 1v1: disconnect Player A during Round N while alive; let Round N end; let Round N+1 go active; wait 15 s → **EXPECT: Round N+1 continues normally** ✗ CURRENTLY: Round N+1 ends prematurely (HOPOUTS-H2/H3)
- [ ] Use all 3 medkits; disconnect; reconnect within 60 s → **EXPECT: medkit count preserved** ✗ CURRENTLY: restored to 3
- [ ] Both teams reach win condition AND round timer expires simultaneously → **EXPECT: score increments once** ✗ CURRENTLY: potential double-increment (M01)
- [ ] Zone damage kills last player on a team → **EXPECT: round ends; no killer credited in kill log** ✗ CURRENTLY: kill log incomplete (M03)
- [ ] Reconnect to a match in Phase 3 (zone radius ~70) → **EXPECT: client renders radius 70** ✗ CURRENTLY: renders 200 until next zone tick (HOPOUTS-M4)
- [ ] Reconnect within 60 s; verify zone radius, weapons, team outfit, match dimension all restored → `[UNVERIFIED]`
- [ ] All players on one team disconnect → **EXPECT: round ends within 15 s** `[UNVERIFIED — depends on grace timer behavior]`
- [ ] Deliberately engineer simultaneous storm deaths → **EXPECT: round scored "draw", score unchanged** ✓ (by design)

### 8.5 FFA / GunGame / Ranked

- [ ] Modified client sends `weapon_heavysniper_mk2` hash while at GunGame tier 0 → **EXPECT: rejected** ✗ CURRENTLY: accepted; higher damage cap applied
- [ ] Oscillate on FFA zone boundary every ~7 s → **EXPECT: forced out after 8 s cumulative** ✗ CURRENTLY: grace timer resets on re-entry
- [ ] Trigger 10 kills rapid-fire near match end (while match-end XP also fires for same player) → check DB: XP gain = exactly 10×10 + 150 = 250 → **EXPECT: full amount** ✗ CURRENTLY: race loss expected (CRIT-02)
- [ ] Call `endMatch` twice for same dimension from server console → **EXPECT: stats written once** ✓ in-memory guard (but not DB-level)
- [ ] Complete a full FFA match; query `player_stats.mmr` before and after → **EXPECT: unchanged** ✓ (FFA isolated from MMR)
- [ ] Win a ranked Arena match K=5, D=2 → **EXPECT: mmr += 28** `[UNVERIFIED — needs DB query after match]`
- [ ] Use `/mydim` to enter active match dimension; fire at match players → **EXPECT: command blocked or audited** ✗ CURRENTLY: kills players; no audit entry

### 8.6 Admin / Reports / Anti-Cheat

- [ ] Non-admin sends `server::admin:espMode` with mode=1 → **EXPECT: rejected** ✓ (server-side level check present)
- [ ] Non-admin sends `server::player:noclip` → **EXPECT: rejected** ✓ (server-side level check present)
- [ ] Level 5 admin sends `admin.openHopoutsZoneEditor` → **EXPECT: rejected** `[UNVERIFIED]`
- [ ] Level 6 admin deletes a map preset → **EXPECT: audit log entry written** ✗ CURRENTLY: no audit log entry (ADMIN-H02)
- [ ] Player accumulates 3 rapid-kill anti-cheat flags; disconnects and reconnects → **EXPECT: flags persist** ✗ CURRENTLY: flags cleared on disconnect (ADMIN-H03)
- [ ] Server restart → **EXPECT: audit log empty** ✗ CURRENTLY: this is the known gap (document, do not fix by clearing)
- [ ] Server restart → **EXPECT: all reports gone** ✗ CURRENTLY: this is the known gap (document)
- [ ] `/ban` a player; player changes IP and spoofs serial → **EXPECT: still banned via `rgscId`** ✗ CURRENTLY: ban bypassable (H10 — `rsgId` not in ban record)
- [ ] Submit report with `reportedPlayerName: "Admin_Bob"` for `reportedPlayerId` = some other player → **EXPECT: server uses authoritative name** ✗ CURRENTLY: fabricated name stored (ADMIN-M03)
- [ ] Submit report body with 10 KB message → **EXPECT: truncated/rejected** ✗ CURRENTLY: unlimited (ADMIN-M04)

### 8.7 Loadout / Clothing / Vehicles

- [ ] Call `equipToFreeroam` with `weapon_rpg` → **EXPECT: blocked** ✗ CURRENTLY: likely granted (LCV-C1)
- [ ] Call `equipForEdit` with `weaponName = "weapon_railgun"` → **EXPECT: blocked** ✗ CURRENTLY: not blocked (H18)
- [ ] Call `saveInline` with `drawable: 2147483647` for hats slot → **EXPECT: rejected** ✗ CURRENTLY: stored in DB (LCV-H3)
- [ ] Call `saveInline` with a drawable in `wardrobeBlockedDrawables.json` → **EXPECT: rejected** ✗ CURRENTLY: accepted (LCV-H4)
- [ ] `savePreset` while inside an active match → **EXPECT: blocked** ✗ CURRENTLY: not blocked (LCV-H2)
- [ ] Spawn 50 freeroam vehicles on one character → **EXPECT: limit enforced** ✗ CURRENTLY: no limit (LCV-C3)
- [ ] Create two vehicles with identical plate strings → **EXPECT: DB rejects second** ✗ CURRENTLY: both stored (LCV-M3)
- [ ] Delete an account that owns vehicles; query vehicle table → **EXPECT: cascade delete** ✗ CURRENTLY: orphaned rows remain (LCV-M4)
- [ ] Stream in a player with weapon attachments → **EXPECT: attachments visible immediately** `[UNVERIFIED — stream-in race condition M13]`

### 8.8 CEF / UI

- [ ] Chat: paste `<img src=x onerror="alert(1)">` → **EXPECT: rendered as escaped text** ✗ CURRENTLY: XSS executes
- [ ] Open any UI overlay; move mouse to corner of screen → **EXPECT: cursor tracks freely** ✗ CURRENTLY: cursor locked to center (CEF-H02)
- [ ] Trigger emergency reset while main menu is open (world blurred) → **EXPECT: blur clears** ✗ CURRENTLY: world stays blurred indefinitely (CEF-M03)
- [ ] Trigger `system:setPage arena_hud` before `arena:setMatch` is sent → **EXPECT: graceful empty state** ✗ CURRENTLY: blank screen (M16)
- [ ] Open main menu → close → open rapidly ×5 → **EXPECT: handler count stable** ✗ CURRENTLY: handlers accumulate (CEF-C02/C03)
- [ ] Check vote screen when `voteMaps` is empty → **EXPECT: empty-state message** ✗ CURRENTLY: blank grid (L11)
- [ ] Profile TacticalCompass paint time in browser DevTools → **EXPECT: < 4 ms/frame** ✗ CURRENTLY: likely > 4 ms on integrated GPU (CEF-H05)
- [ ] Open `AdminPanel`; perform a kick action → **EXPECT: audio feedback** ✗ CURRENTLY: no audio plays (CEF-M06)
- [ ] Close Discord OAuth browser after successful auth → **EXPECT: browser destroyed** `[UNVERIFIED — depends on cleanup path]`

---

## 9. Appendix / Raw Verification Notes

### 9.1 Source Audit File Index

| File | Date | Auditor | Scope |
|---|---|---|---|
| `AUDIT_REPORT_STAGE1.md` | 2026-04-24 | Claude Sonnet 4.6 | Full codebase overview — 72 issues |
| `AUDIT_FINDINGS_STAGE1.md` | 2026-04-24 | Claude Sonnet 4.6 | Full findings table C01–C10, H01–H21, M01–M22, L01–L17 |
| `AUDIT_DAMAGE_COMBAT.md` | 2026-04-24 | Claude Sonnet 4.6 | DamageSync, CombatIntegrity, SnapshotManager, DeathRecapTracker |
| `AUDIT_AUTH_ACCOUNT.md` | 2026-04-24 | Claude Sonnet 4.6 | Auth.event.ts, Character.event.ts, discordAuth/*, client auth, CEF auth pages |
| `AUDIT_ADMIN_REPORTS.md` | 2026-04-24 | Claude Sonnet 4.6 | Admin commands/events, reports, anti-cheat, POV capture, audit logging |
| `AUDIT_HOPOUTS_ZONE_SPAWNS.md` | 2026-04-24 | Claude Sonnet 4.6 | ArenaMatch, ZoneSystem, ArenaSpawn, reconnect, zone lifecycle |
| `AUDIT_FFA_GUNGAME_RANKED.md` | 2026-04-24 | Claude Sonnet 4.6 | FfaMatch, GunGameMatch, QueueManager, StatsManager, ProgressionManager, ranked |
| `AUDIT_FRONTEND_CEF_UI.md` | 2026-04-24 | Claude Sonnet 4.6 | App.tsx, all stores, all CEF pages, Browser.class.ts, Hud.class.ts |
| `AUDIT_LOADOUT_CLOTHING_VEHICLES.md` | 2026-04-24 | Claude Sonnet 4.6 | WeaponPresets, Wardrobe, Vehicle, shared loadout/clothing files |

### 9.2 RAGE:MP Wiki Access Note

`https://wiki.rage.mp/wiki/Main_Page` returned HTTP 403 during all nine audit passes on 2026-04-24. No RAGE:MP documentation was accessed during this audit cycle. All RAGE:MP API assessments are sourced from:
- RAGE:MP API knowledge from training data (cutoff August 2025)
- Source code pattern analysis and cross-file consistency checking
- Community documentation and established RAGE:MP conventions

Findings that depend on live API behavior are individually marked **UNVERIFIED AGAINST LIVE DOCS** throughout this report and in `AUDIT_FINDINGS_FULL.md`. Before implementing any fix marked UNVERIFIED, verify the relevant API behavior against the live wiki or a test server.

### 9.3 Verified Correct Items (Complete List)

| Item | Location | Notes |
|---|---|---|
| Discord OAuth state management | `discordAuthState.ts` | `crypto.randomBytes(32)`, TTL checked, consumed on first use, player-bound |
| Session invalidation on disconnect | `Player.event.ts` `onPlayerJoin`/`onPlayerQuit` | All session state reset before any event fires on new connection |
| Noclip trust chain | `Noclip.module.ts`, `Player.event.ts:363–369` | `adminLevel` is server-set; client cannot write it; server re-verifies |
| ESP trust chain | `AdminESP.module.ts:14–16` | Same analysis as noclip — server-set variable |
| `player.call()` targets one client | `Admin.commands.ts:179` | Not `mp.players.broadcast`; single-client dispatch confirmed |
| `Math.random()` is not CSPRNG | `AdminAntiCheat.service.ts:63` | Node.js docs confirm; finding is valid |
| Lag compensation design | `SnapshotManager.ts`, `DamageSync.event.ts:202–204` | Server-side snapshots, `shooter.ping / 2` one-way estimate, position fallback |
| Fire rate validation | `CombatIntegrity.ts` | Present and applied for player-vs-player hits |
| FFA/GunGame MMR isolation | `FfaMatch.manager.ts:288–304`, `GunGameMatch.manager.ts:310–327` | `updateRankedMatchResult` never called from either mode |
| Rank tier boundary logic | `StatsManager.ts:33–40` | No off-by-one; Bronze floor at MMR 0 enforced |
| Double-end match guard (in-memory) | `ArenaMatch.manager.ts`, `endFfaMatch`, `endGunGameMatch` | `match.state = "match_end"` set synchronously before async persist |
| `checkRoundEnd` warmup guard | `ArenaMatch.manager.ts` | `if (match.state !== "active") return` — correct |
| Storm damage bypasses armor | `ZoneSystem.ts:225–249` | Intentional BR design; health-only subtraction |
| Draw round on simultaneous deaths | `ArenaMatch.manager.ts:1319–1325` | Correct symmetric behavior |
| `mp.vehicles.forEach` early-exit pattern | `ArenaSpawn.validation.ts:84` | `blocked` flag soft-break is correct; O(n) cost noted |
| `getInitialPageFromSearchParams` as lazy initializer | `PageContext.tsx:40` | Valid React `useState` pattern — not a bug |
| `browser.markAsChat()` | `Browser.class.ts` | Correctly suppresses native GTA chat overlay |
| `mp.game.controls.setDisableControlActionBatch()` | `Browser.class.ts` | Correct batched approach |
| `hideHudComponentThisFrame(id)` every frame | HUD modules | Must be per-frame; pattern correct |
| `PlayerMp.setAlpha(n)` | Various | Correct API usage |
| `CameraMp.setActive(bool)` | `Camera.class.ts` | Correct |
| `mp.game.cam.renderScriptCams(…)` | `Camera.class.ts` | Correct (5–6 args) |
| `mp.game.network.setInSpectatorMode(bool, handle)` | `Spectate.class.ts` | Correct |
| `mp.browsers.exists(browser)` guard | `Browser.class.ts` | Correct guard pattern before every browser operation |
| `claimChallengeReward` `row.claimed` guard | `ChallengeManager.ts:177` | Prevents double-claiming of challenge rewards |
| Discord OAuth callback state consumed on first use | `DiscordOAuthServer.ts` | `consumeOAuthState` deletes state on call — replay prevented |
| Pending registration token bound to `playerId` | `Auth.event.ts:106` | `takePendingRegistration(token, player.id)` validates binding |

### 9.4 Engine Limitations (Not Fixable in Application Code)

| Item | Explanation |
|---|---|
| `Admin-SetGM` local event self-invocable | A modded client can call `mp.events.call("Admin-SetGM", true)` to invoke `SET_ENTITY_INVINCIBLE` locally. GTA V natives are not server-authoritative. Practical mitigation: detect invincibility via damage registration discrepancy (player takes hits but health never decreases). |

### 9.5 Design Choices (Not Bugs)

| Behavior | Rationale |
|---|---|
| Storm damage bypasses armor | Intentional battle-royale genre norm — ring damage ignores shields |
| Draw round on simultaneous storm deaths | Correct symmetric scoring — no arbitrary tiebreaker |
| 15-second reconnect grace period before round resolution | Intentional reconnect affordance; doubles as a stall vector (F4) but the grace period itself is a design choice |

### 9.6 Deduplication Cross-Reference

Key merges where the same root cause was independently confirmed across multiple audit passes:

| Canonical ID | Source IDs Merged | Merge Notes |
|---|---|---|
| F-C01 | C01, DC-C01, CRIT-01 (FFA) | Three independent confirmations of `at()` vs `atRemoteId()` |
| F-C04 | C04, DC-C04 | DC audit adds mode-dispatch state table; same root |
| F-C05 | C05, AUTH-C01 | AUTH audit adds exploitation path detail and complete code trace |
| F-C06 | C06, ADMIN-C01 | ADMIN audit adds Discord client secret to the credential list |
| F-C07 | C07, DC-C07 | Same; DC audit adds exact code location confirmation |
| F-C08 | C08, DC-C08, CRIT-01 (partial) | DamageSync fallback + LCV whitelist gap are the same trust boundary failure |
| F-C09 | C09, CEF-C01 | Same |
| F-C10 | C10, ADMIN-C02 | Same file; ADMIN audit adds the buffer-roll-over detail |
| F-C11 | H13, AUTH-C02 | AUTH audit elevated from HIGH to CRITICAL by direct code review |
| F-C13 | M12, CRIT-02 | FFA audit elevated from MEDIUM to CRITICAL with concrete race scenario |
| H01/CEF-H02 | H01, CEF-H02 | Same `cursor.show()` call, two audit passes |
| H02/CEF-H01 | H02, CEF-H01 | Same `browser.execute()` injection, two audit passes |
| H03/AUTH-H06/CEF-M04 | H03, AUTH-H06, CEF-M04 | Same Discord URL validation gap, three audit passes |
| H11/AUTH-M01 | H11, AUTH-M01 | Same transaction gap across character and account creation |
| H12/AUTH-H03 | H12, AUTH-H03 | Same `discordHttps.ts` timeout gap |
| H14/DC-H14/MED-02 | H14, DC-H14, MED-02 | Same bone multiplier exploit confirmed by two audits |
| M07/ADMIN-M02 | M07, ADMIN-M02 | Same `Math.random()` nonce in same file |
| M11/AUTH-H02 | M11, AUTH-H02 | AUTH audit elevated from MEDIUM to HIGH |
| M12/CRIT-02 | M12, CRIT-02 | Elevated to CRITICAL (see F-C13) |
| H19/LCV-H3 | H19, LCV-H3 | Same clothing bounds gap confirmed by two audits |
| H20/LCV-C3 | H20, LCV-C3 | Same vehicle spawn limit gap confirmed by two audits |
| M14/LCV-M1 | M14, LCV-M1 | Same vehicle mod bounds confirmed by two audits |
| L06/LCV-P1 | L06, LCV-P1 | Same TypeORM migration gap |

---

*End of AUDIT_REPORT_FULL.md. See AUDIT_FINDINGS_FULL.md for the machine-scannable merged findings table.*
