# Full-Stack RAGE:MP Server Audit — Execution Plan

## Context

The user wants a **hostile, correctness-first, comprehensive audit** of an entire RAGE:MP GTA V PvP server codebase. The audit must:
- Verify every RAGE:MP API usage against wiki.rage.mp (source of truth)
- Identify runtime bugs, logic bugs, desync risks, race conditions, broken systems
- Critique UI/UX quality, gameplay integrity, admin/staff trust flows
- Produce a structured report in a specific format (sections 1–9 as specified)
- Be brutally honest — no generic praise, no hiding uncertainty

**Nothing is to be modified.** This is a read-only audit pass.

---

## Repo Location

All files are **local only** (not on GitHub):
```
C:\Users\Matei\Downloads\arena-server-backup-master\arena-server-backup-master\
```

Key subdirectory: `gamemode/` (source) and `ragemp-server/` (runtime).

---

## What We Know from Exploration (Phase 1 Summary)

### Stack
- **Server:** TypeScript → Webpack → Node.js (RAGE:MP embedded), PostgreSQL + TypeORM
- **Client:** TypeScript → Webpack → RAGE:MP client runtime
- **Frontend (CEF):** React 18 + Vite + MobX + Tailwind + Radix UI + GSAP
- **Shared:** TypeScript interfaces, constants, event names

### Game Modes
1. **Hopouts/Arena** — team-based competitive rounds with shrinking zone (storm), best-of-7
2. **FFA** — free-for-all deathmatch, first to N kills
3. **Gun Game** — progressive weapon tier advancement on kill
4. **Freeroam** — private dimension sandbox with shooting range

### Systems Identified
- Auth: Discord OAuth + account/character creation
- Admin: 8-tier level system, POV capture, ESP, noclip, spectate, anti-cheat
- Report/Support: CEF report widget with evidence attachment
- Stats: XP, progression, leaderboard, challenges, prestige, seasons
- Party/Friends: Social graph
- Weapons: Preset system with attachments, tints, ammo
- Clothing: Wardrobe with region-based component limits
- Vehicles: Dynamic spawning, mods, tuning
- Combat: Damage sync (client-authoritative hit detection), hitmarkers, death recap
- Persistence: TypeORM entities (accounts, bans, characters, vehicles, loadouts, stats, season data)

### Pre-Identified Critical Risks (from Phase 1)
1. **Camera.class.ts:372** — `setInterval(..., 0)` — CPU spin-lock on client render thread
2. **Player.prototype.ts** — 6× `@ts-ignore` on native invocations including `setWeaponWheel` with unbounded `setInterval`
3. **DamageSync.module.ts** — Client sends `remoteId, bone, weaponHash` to server — client-authoritative damage with unclear server validation
4. **Browser.class.ts:637** — `mp.events.callRemote(event, JSON.stringify(args))` — JSON passthrough without server-side schema validation visible
5. **Raycast.class.ts:23-26** — `@ts-ignore` on `setEntityOverlayPassEnabled` and `createEntityOverlayBatch` — undocumented natives
6. **Multiple unbounded setInterval() calls** — Hud.class.ts (100ms), Client.class.ts, Spectate.class.ts, Player.prototype.ts
7. **Render.event.ts** — Per-frame HUD hiding of multiple components every single frame (expensive if not necessary)
8. **Weapon hash validation** — No evidence of server-side weapon hash whitelist validation in damage events

---

## Audit Execution Plan

The audit will be executed in **6 passes**, each producing findings for the final report. Each pass requires reading specific source files deeply and cross-checking with wiki.rage.mp where relevant.

---

### Pass 1 — RAGE:MP API Compliance Audit
**Goal:** Verify all RAGE:MP-specific API usages against wiki.rage.mp.

Files to deep-read:
- `gamemode/source/client/clientevents/Render.event.ts` — render loop, HUD hiding, control disabling
- `gamemode/source/client/classes/Camera.class.ts` — camera creation, activation, render script cams
- `gamemode/source/client/classes/Browser.class.ts` — browser creation, CEF lifecycle, callRemote bridging
- `gamemode/source/client/classes/Raycast.class.ts` — entity overlay batch (undocumented natives)
- `gamemode/source/client/prototype/Player.prototype.ts` — native invocations, prototype extension
- `gamemode/source/client/modules/DamageSync.module.ts` — client-side hit detection and server call
- `gamemode/source/server/serverevents/Player.event.ts` — server player events (death, dimension, spectate)
- `gamemode/source/server/classes/Vehicle.class.ts` — vehicle creation API
- `gamemode/source/client/modules/ArenaMinimap.module.ts` — minimap/radar control
- `gamemode/source/client/modules/ArenaRadar.module.ts` — radar zone visualization

Wiki pages to cross-check:
- https://wiki.rage.mp/index.php?title=Events (client/server event list)
- https://wiki.rage.mp/index.php?title=Mp.browsers (browser API)
- https://wiki.rage.mp/index.php?title=Mp.cameras (camera API)
- https://wiki.rage.mp/index.php?title=Player (player API — server and client sides)
- https://wiki.rage.mp/index.php?title=Mp.players (player pool API)
- https://wiki.rage.mp/index.php?title=Vehicle (vehicle API)
- https://wiki.rage.mp/index.php?title=Entity (entity shared methods)

---

### Pass 2 — Boot / Auth / Character / Session Lifecycle
**Goal:** Trace the full join→auth→character→spawn flow for correctness and desync risks.

Files to deep-read:
- `gamemode/source/server/serverevents/Auth.event.ts`
- `gamemode/source/server/serverevents/Character.event.ts`
- `gamemode/source/server/serverevents/Player.event.ts`
- `gamemode/source/server/modules/discordAuth/DiscordOAuthServer.ts`
- `gamemode/source/server/modules/discordAuth/AccountSession.ts`
- `gamemode/source/server/index.ts`
- `gamemode/source/client/index.ts`
- `gamemode/source/client/clientevents/Auth.event.ts`
- `gamemode/source/client/clientevents/Player.event.ts`
- `gamemode/source/client/classes/Browser.class.ts` (CEF page routing logic)
- `gamemode/frontend/src/App.tsx` (root React router)
- `gamemode/frontend/src/PageContext.tsx`
- `gamemode/frontend/src/pageLifecycle.ts`
- `gamemode/frontend/src/pages/auth/Authentication.tsx`
- `gamemode/frontend/src/pages/selectcharacter/`

Questions to answer:
- Can a player skip auth by triggering post-auth events directly?
- Is there session invalidation on disconnect?
- What happens if Discord OAuth fails mid-flow?
- What happens if the DB is unavailable at character load time?
- Is the CEF page routing validated server-side or is it purely client-controlled?
- Can a client call `server::player:setCefPage` with an arbitrary page name?

---

### Pass 3 — Gameplay Systems (Arena, FFA, Gun Game, Freeroam)
**Goal:** Audit match lifecycle, spawn/zone logic, scoring, win conditions, and exploitable edges.

Files to deep-read:
- `gamemode/source/server/modes/hopouts/ArenaMatch.manager.ts`
- `gamemode/source/server/modes/hopouts/ZoneSystem.ts`
- `gamemode/source/server/modes/hopouts/HopoutsZones.runtime.ts`
- `gamemode/source/server/modes/hopouts/ArenaSpawn.validation.ts`
- `gamemode/source/server/modes/ffa/FfaMatch.manager.ts`
- `gamemode/source/server/modes/gungame/GunGameMatch.manager.ts`
- `gamemode/source/server/modules/matches/MatchManager.ts`
- `gamemode/source/server/modules/matches/ReconnectManager.ts`
- `gamemode/source/server/modules/matchmaking/QueueManager.ts`
- `gamemode/source/server/serverevents/Death.event.ts`
- `gamemode/source/server/serverevents/DamageSync.event.ts`
- `gamemode/source/server/modules/combat/CombatIntegrity.ts`
- `gamemode/source/server/modules/combat/CompetitiveGodmode.util.ts`
- `gamemode/source/server/modules/combat/DeathRecapTracker.ts`
- `gamemode/source/server/modules/combat/SnapshotManager.ts`
- `gamemode/source/server/commands/Freeroam.commands.ts`
- `gamemode/source/client/modules/ArenaZone.module.ts`
- `gamemode/source/client/modules/ArenaVitals.module.ts`
- `gamemode/source/client/modules/ArenaSpectateController.module.ts`
- `gamemode/data/arenas.json`
- `gamemode/data/hopouts_zones.json`

Questions to answer:
- Is death handled server-side or does the client call `playerDeath`?
- Is damage validated server-side (weapon hash whitelist, bone index range, cooldown)?
- What prevents kill farming (dying to the same player repeatedly)?
- What happens when a player disconnects mid-round?
- Can a player rejoin a match they left?
- Is zone damage applied server-side or client-side?
- Can a player exploit zone boundary to avoid damage while still being in the playable area?
- What happens if a round ends with 0 survivors?
- Are spawn points validated to not overlap with zone damage areas?
- Is warmup godmode enforced server-side?
- Can a gun game player advance tiers by having someone take damage on their behalf?

---

### Pass 4 — Admin, Reports, and Trust Systems
**Goal:** Audit admin command security, trust model, report workflow, and anti-cheat integrity.

Files to deep-read:
- `gamemode/source/server/commands/Admin.commands.ts`
- `gamemode/source/server/admin/AdminAntiCheat.service.ts`
- `gamemode/source/server/admin/AdminAudit.service.ts`
- `gamemode/source/server/admin/AdminPovCapture.service.ts`
- `gamemode/source/server/admin/AdminChat.service.ts`
- `gamemode/source/server/admin/AdminLog.manager.ts`
- `gamemode/source/server/admin/AdminEvidenceCef.service.ts`
- `gamemode/source/server/admin/registeredCommandExecution.ts`
- `gamemode/source/server/report/Report.manager.ts`
- `gamemode/source/server/serverevents/Report.event.ts`
- `gamemode/source/server/serverevents/Admin.event.ts`
- `gamemode/source/client/modules/AdminESP.module.ts`
- `gamemode/source/client/modules/AdminGodmode.module.ts`
- `gamemode/source/client/modules/AdminAntiCheat.module.ts`
- `gamemode/source/client/modules/AdminPovCapture.module.ts`
- `gamemode/source/client/modules/Noclip.module.ts`
- `gamemode/frontend/src/pages/admin/AdminPanel.tsx`
- `gamemode/frontend/src/pages/adminIngame/AdminIngamePanel.tsx`
- `gamemode/frontend/src/pages/adminMini/AdminMiniPanel.tsx`
- `gamemode/frontend/src/pages/report/`

Questions to answer:
- Is admin level validated server-side on every command or just at login?
- Can a player fake their admin level by setting a variable?
- Is `server::admin:espMode` validated server-side for admin status?
- Can noclip be triggered by a non-admin?
- Is the anti-cheat heartbeat actually cryptographically safe or just a nonce?
- Can a player suppress POV capture by blocking the frame event?
- Is the report system rate-limited to prevent spam?
- What happens if an admin bans themselves?
- Are admin commands logged to a persistent audit trail?

---

### Pass 5 — Weapons, Loadout, Clothing, Vehicles, Persistence
**Goal:** Audit loadout application integrity, clothing sync, vehicle mod correctness, and data persistence safety.

Files to deep-read:
- `gamemode/source/server/arena/WeaponPresets.service.ts`
- `gamemode/source/server/serverevents/Wardrobe.event.ts`
- `gamemode/source/server/serverevents/Vehicle.event.ts`
- `gamemode/source/server/database/entity/WeaponPreset.entity.ts`
- `gamemode/source/server/database/entity/Vehicle.entity.ts`
- `gamemode/source/server/database/entity/Character.entity.ts`
- `gamemode/source/server/database/entity/Account.entity.ts`
- `gamemode/source/server/database/entity/Ban.entity.ts`
- `gamemode/source/server/database/Database.module.ts`
- `gamemode/source/client/modules/WeaponPresetApply.module.ts`
- `gamemode/source/client/modules/WeaponPresetReliability.module.ts`
- `gamemode/source/client/modules/WeaponComponentTintSync.module.ts`
- `gamemode/source/client/modules/WeaponsOnBody.module.ts`
- `gamemode/source/client/modules/WeaponDraw.module.ts`
- `gamemode/source/client/modules/WeaponSelection.module.ts`
- `gamemode/source/client/modules/Attachments.module.ts`
- `gamemode/source/client/modules/ClothingEditorCamera.module.ts`
- `gamemode/source/client/modules/ClothesSync.module.ts`
- `gamemode/source/client/classes/Vehicle.class.ts`
- `gamemode/source/shared/loadout/weaponRegistry.ts`
- `gamemode/source/shared/loadout/loadout.types.ts`
- `gamemode/source/shared/loadout/loadout.constants.ts`
- `gamemode/frontend/src/pages/loadout/LoadoutPanel.tsx`
- `gamemode/frontend/src/pages/clothing/ClothingPanel.tsx`
- `gamemode/frontend/src/pages/tuner/`

Questions to answer:
- Is loadout applied server-side or client-side? Can a player give themselves weapons?
- Are weapon hashes whitelisted or can any hash be applied?
- Is attachment data validated before applying to avoid component index out-of-range?
- Are vehicle mod indices validated server-side (prevent invalid mod IDs)?
- Can clothing component indices exceed the game's valid range?
- Is database write happening synchronously where it should be async (blocking event loop)?
- Are there SQL injection risks in TypeORM query usage?
- What happens if character data is partially saved (mid-write disconnect)?
- Is ban expiry enforced at join or only checked manually?

---

### Pass 6 — Frontend/CEF UI, Chat, HUD, Performance
**Goal:** Audit CEF page lifecycle, UI state machines, chat, scoreboard, and performance/reliability.

Files to deep-read:
- `gamemode/frontend/src/App.tsx`
- `gamemode/frontend/src/PageContext.tsx`
- `gamemode/frontend/src/pageLifecycle.ts`
- `gamemode/frontend/src/pages/hud/Hud.tsx`
- `gamemode/frontend/src/pages/hud/Chat/`
- `gamemode/frontend/src/pages/hud/MainHud/`
- `gamemode/frontend/src/pages/mainmenu/MainMenu.tsx`
- `gamemode/frontend/src/pages/arena/ArenaHud.tsx`
- `gamemode/frontend/src/pages/arena/Lobby.tsx`
- `gamemode/frontend/src/pages/arena/ReadyCheck.tsx`
- `gamemode/frontend/src/pages/arena/Voting.tsx`
- `gamemode/frontend/src/pages/ffa/FfaHud.tsx`
- `gamemode/frontend/src/pages/gungame/GunGameHud.tsx`
- `gamemode/frontend/src/stores/Arena.store.ts`
- `gamemode/frontend/src/stores/Hud.store.ts`
- `gamemode/frontend/src/stores/Chat.store.ts`
- `gamemode/frontend/src/utils/EventManager.util.ts`
- `gamemode/source/client/classes/Browser.class.ts` (CEF bridging, input locking)
- `gamemode/source/client/classes/Hud.class.ts` (100ms weapon tracking, 5s player count)
- `gamemode/source/client/modules/Speedometer.module.ts`
- `gamemode/source/server/serverevents/Chat.event.ts`
- `gamemode/frontend/tsc_errors.txt` (existing TypeScript errors)

Questions to answer:
- Are there dead CEF pages that can receive state but never render?
- Can the CEF get stuck in a page that doesn't match the server-side state?
- Is there a "close all CEF" escape hatch for broken states?
- Does the chat validate message length and XSS sanitize before render?
- Can a player send chat messages without being authenticated?
- Is the scoreboard state authoritative (server-driven) or client-computed?
- What is the render cost of the per-frame HUD hiding in Render.event.ts?
- Are GSAP animations properly cleaned up to avoid memory leaks?
- Does the audio system (Howler) clean up on page transitions?
- Does MobX store state leak between matches (stale store state)?
- What does `tsc_errors.txt` contain?

---

### Pass 7 — Static Analysis & Build Checks
**Goal:** Run safe static checks and harvest build/lint output.

Actions (read-only):
- Read `gamemode/frontend/tsc_errors.txt` fully
- Read `gamemode/.cursor/debug-7675aa.log` if accessible
- Read `AUDIT_REPORT.md`, `VERIFIED_ISSUES.md`, `PLAYABILITY_STRIKE_LIST.md` (prior self-assessments — compare against actual code state)
- Search for: `@ts-ignore`, `@ts-nocheck`, `any`, `TODO`, `FIXME`, `HACK`, `eslint-disable`
- Search for duplicate `mp.events.add()` event name registrations
- Search for `console.log` / `console.error` left in production paths
- Search for hardcoded credentials or tokens in source
- Read `gamemode/conf.json` for `allow-cef-debugging: true` (should be false in prod)
- Check `gamemode/.env.example` for credential structure
- Verify `stream-distance` in conf.json is appropriate for the map sizes

---

## Final Report Format

The audit output will follow the exact structure specified in the user's prompt:
1. Executive Summary
2. Repo/System Inventory
3. RAGE:MP API Compliance Findings (per-finding: severity, file, code, wiki, mismatch, fix direction)
4. System-by-System Findings (one section per major system)
5. UI/UX Quality Findings (page-by-page critique)
6. Gameplay Integrity Findings
7. Highest Priority Fix List (ranked: must-fix / should-fix / polish)
8. Runtime Test Checklist
9. Appendix — Raw Verification Notes

---

## Verification Method

For each RAGE:MP API finding:
- Fetch the relevant wiki.rage.mp page via WebFetch
- Compare documented signature/behavior to code usage
- Classify: VERIFIED CORRECT / HIGH-CONFIDENCE BUG / HIGH-CONFIDENCE RISK / PLAUSIBLE RISK / UNVERIFIED ASSUMPTION

For each gameplay finding:
- Read the relevant server-side code path completely
- Trace the full client→server→client event flow
- Identify where validation is missing or incomplete

For each UI finding:
- Read the React component fully
- Check store bindings for staleness/leak risks
- Check event cleanup in useEffect hooks
- Evaluate visual/UX quality from component structure

---

## Execution Order (Parallel Where Possible)

The implementation will launch multiple specialized subagents in parallel per pass, then synthesize findings:

- **Pass 1 + Pass 7** in parallel (API audit + static checks — both are self-contained)
- **Pass 2 + Pass 4** in parallel (auth lifecycle + admin trust — both are server-side focused)
- **Pass 3** alone (gameplay systems — largest pass, needs full attention)
- **Pass 5** alone (persistence + weapons — needs careful correctness checking)
- **Pass 6** alone (frontend — React component audit + CEF lifecycle)
- **Synthesis** — combine all findings into final structured report

Each subagent will be told to read specific files and cross-check wiki pages. RAGE:MP wiki fetches will be done in the synthesis pass to avoid redundant network calls.

---

## Critical Files Index (Quick Reference)

| Priority | File | Why Critical |
|---|---|---|
| P0 | `source/client/classes/Camera.class.ts` | 0ms setInterval confirmed |
| P0 | `source/client/modules/DamageSync.module.ts` | Client-auth damage |
| P0 | `source/client/prototype/Player.prototype.ts` | 6× @ts-ignore + setInterval |
| P0 | `source/server/serverevents/DamageSync.event.ts` | Server-side damage validation |
| P1 | `source/client/clientevents/Render.event.ts` | Per-frame cost |
| P1 | `source/client/classes/Browser.class.ts` | CEF lifecycle + callRemote |
| P1 | `source/server/modes/hopouts/ArenaMatch.manager.ts` | Match lifecycle |
| P1 | `source/server/commands/Admin.commands.ts` | Admin trust surface |
| P1 | `source/server/serverevents/Auth.event.ts` | Auth flow |
| P2 | `source/server/database/Database.module.ts` | DB setup |
| P2 | `frontend/src/pageLifecycle.ts` | CEF page routing |
| P2 | `frontend/tsc_errors.txt` | Known TS errors |
| P2 | `source/client/modules/AdminAntiCheat.module.ts` | AC client side |

---

## Notes & Constraints

- All reads are local. No GitHub. Path root: `C:\Users\Matei\Downloads\arena-server-backup-master\arena-server-backup-master\`
- The compiled `packages/server/index.js` and `client_packages/app.js` are build artifacts — audit the TypeScript source only
- `ragemp-server/` contains only the runtime binary and built outputs — not relevant for source audit
- `gamemode/docs/` contains prior audit docs (AUDIT_REPORT.md, REFACTOR_PLAN.md, VERIFIED_ISSUES.md) — these must be compared against actual code to verify if fixes were applied
- `allow-cef-debugging: true` in conf.json is a security concern for production
- The frontend has a `tsc_errors.txt` which likely contains real TypeScript errors — must read this first
- Prior audit docs exist (AUDIT_REPORT.md, PLAYABILITY_STRIKE_LIST.md, VERIFIED_ISSUES.md) — these indicate the codebase has been through at least one audit pass already; the new audit must find what those missed or what regressed
