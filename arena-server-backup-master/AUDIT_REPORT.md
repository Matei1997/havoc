# Rage Arena - Full Architecture & Systems Audit

**Date:** 2026-03-12
**Scope:** Complete server, client, and CEF UI codebase analysis
**Project:** Rage Arena PvP Server (RageMP)

---

## SECTION 1 — PROJECT ARCHITECTURE

### 1.1 High-Level Architecture Map

```
┌─────────────────────────────────────────────────────────────────┐
│                        SERVER (TypeScript)                      │
│  ┌─────────┐ ┌────────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │  Modes   │ │  Modules   │ │  Events  │ │   Database       │  │
│  │ hopouts  │ │ matchmake  │ │ 24 event │ │ TypeORM entities │  │
│  │ ffa      │ │ party      │ │ handlers │ │ Account, Char,   │  │
│  │ gungame  │ │ stats      │ │          │ │ Stats, Season,   │  │
│  │ freeroam │ │ seasons    │ │          │ │ Challenges, etc  │  │
│  │ (empty)  │ │ combat     │ │          │ │                  │  │
│  │          │ │ matches    │ │          │ │                  │  │
│  └────┬─────┘ └─────┬──────┘ └────┬─────┘ └────────┬─────────┘  │
│       └──────────────┴─────────────┴────────────────┘            │
│                          ↕ mp.events / RAGERP.cef                │
├──────────────────────────────────────────────────────────────────┤
│                      CLIENT (TypeScript)                         │
│  ┌──────────┐  ┌────────────┐  ┌────────────────────────┐       │
│  │ Classes  │  │  Modules   │  │      Events/Handlers   │       │
│  │ Browser  │  │ DamageSync │  │ Auth, Player, Render   │       │
│  │ Camera   │  │ Recoil     │  │ Attachment             │       │
│  │ Hud      │  │ Crouch     │  │                        │       │
│  │ Spectate │  │ Hitmarker  │  │                        │       │
│  │ Client   │  │ 28 modules │  │                        │       │
│  └────┬─────┘  └────┬───────┘  └────────┬───────────────┘       │
│       └──────────────┴───────────────────┘                       │
│                    ↕ Browser.processEvent / mp.trigger            │
├──────────────────────────────────────────────────────────────────┤
│                      CEF / React UI                              │
│  ┌───────────────┐  ┌───────────────┐  ┌──────────────────┐     │
│  │  Pages        │  │  Stores       │  │  EventManager    │     │
│  │  mainmenu     │  │  Arena.store  │  │  (CEF↔Client     │     │
│  │  arena        │  │  Player.store │  │   bridge)        │     │
│  │  ffa          │  │  Party.store  │  │                  │     │
│  │  gungame      │  │  Hud.store    │  │                  │     │
│  │  hud          │  │  + 9 more     │  │                  │     │
│  │  auth         │  │  (MobX)       │  │                  │     │
│  │  creator      │  │               │  │                  │     │
│  │  wardrobe     │  │               │  │                  │     │
│  │  admin        │  │               │  │                  │     │
│  │  settings     │  │               │  │                  │     │
│  └───────────────┘  └───────────────┘  └──────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 Communication Flow

```
Server Logic (modes/modules)
    ↓ RAGERP.cef.emit(player, channel, event, data)
    ↓ player.call("client::...", [args])
RageMP Client Scripts
    ↓ Browser.processEvent("cef::...", data)
    ↓ mainUI.call("cef::...", JSON.stringify(data))
CEF React UI (EventManager.callHandler)
    ↓ EventManager.emitServer/emitClient
    ↓ mp.trigger("client::eventManager::emitServer", JSON.stringify({event, args}))
Client (routes to server via mp.events.callRemote)
    ↓ mp.events.callRemote("server::...")
Server
```

### 1.3 Directory Layout

```
pvp-server/
└── gamemode-2/
    └── gamemode/
        ├── source/
        │   ├── server/           # 24 event handlers, 7 module groups, 4 game modes
        │   ├── client/           # 12 classes, 28 modules, 4 event files
        │   └── shared/           # Minimal: CefData, utils, ArenaPreset interface
        ├── frontend/             # React CEF UI (Vite + MobX + SCSS modules)
        └── data/                 # Static data files
```

### 1.4 Key Findings — Architecture

| Finding | Severity | Detail |
|---------|----------|--------|
| **Dual arena directory** | Medium | `/server/arena/` contains re-export shims to `/modes/hopouts/`. Every import through the shim adds indirection. |
| **Shared code is underused** | Medium | `source/shared/` has mostly empty directories (.gitkeep). Event names, type interfaces, and constants are duplicated between client/server/UI. |
| **Event names are stringly-typed** | High | All CEF↔client↔server events use raw strings (`"arena"`, `"matchUpdate"`, `"setLobby"`). No shared enum or constant file. Typos cause silent failures. |
| **No shared event contract** | High | Server sends data shapes that UI stores consume, but there is no shared interface defining the contract. Changes on either side can silently break the other. |

---

## SECTION 2 — GAMEPLAY SYSTEM STRUCTURE

### 2.1 System Map

| System | Location | Lines | Notes |
|--------|----------|-------|-------|
| **Matchmaking** | `modules/matchmaking/QueueManager.ts` | ~100 | Generic queue, mode-agnostic |
| **Hopouts Queue** | `modes/hopouts/Arena.module.ts` | 618 | Lobby state machine + voting + ready check |
| **FFA Queue** | `modes/ffa/Ffa.module.ts` | ~80 | Simpler: fill → start |
| **Gun Game Queue** | `modes/gungame/GunGame.module.ts` | ~80 | Same pattern as FFA |
| **Hopouts Match** | `modes/hopouts/ArenaMatch.manager.ts` | 971 | Largest file. Round lifecycle, spectate, zone, items |
| **FFA Match** | `modes/ffa/FfaMatch.manager.ts` | ~300 | Respawn deathmatch |
| **Gun Game Match** | `modes/gungame/GunGameMatch.manager.ts` | ~350 | Weapon tier progression |
| **Match Registry** | `modules/matches/MatchManager.ts` | ~80 | Tracks active matches by dimension |
| **Reconnect** | `modules/matches/ReconnectManager.ts` | ~100 | 60s reconnect window |
| **Stats** | `modules/stats/StatsManager.ts` | ~150 | MMR, K/D, win/loss tracking |
| **Progression** | `modules/stats/ProgressionManager.ts` | ~150 | XP, levels 1-50, level-up |
| **Prestige** | `modules/stats/PrestigeManager.ts` | ~50 | Reset at level 50 |
| **Leaderboard** | `modules/stats/LeaderboardManager.ts` | ~60 | Top 100 by MMR |
| **Profile** | `modules/stats/ProfileManager.ts` | ~80 | Aggregated player profile |
| **Challenges** | `modules/stats/ChallengeManager.ts` | ~200 | Daily/weekly with XP rewards |
| **Seasons** | `modules/seasons/SeasonManager.ts` | ~200 | Parallel seasonal stat tracking |
| **Season Rewards** | `modules/seasons/SeasonRewardsManager.ts` | ~100 | Tier-based rewards |
| **Combat Integrity** | `modules/combat/CombatIntegrity.ts` | ~150 | Fire rate, distance, duplicate hit checks |
| **Death Recap** | `modules/combat/DeathRecapTracker.ts` | ~80 | Per-victim damage log |
| **Snapshots** | `modules/combat/SnapshotManager.ts` | ~80 | Position rewind for lag compensation |
| **Party** | `modules/party/PartyManager.ts` | ~200 | Create, invite, leave, disband |
| **Admin Log** | `admin/AdminLog.manager.ts` | ~80 | In-memory damage/kill log (max 5000) |
| **Weapon Presets** | `arena/WeaponPresets.service.ts` | ~100 | Loadout save/load |
| **Attachments** | `arena/WeaponAttachments.data.ts` | ~300 | Weapon component definitions |

### 2.2 Key Findings — Gameplay Systems

| Finding | Severity | Detail |
|---------|----------|--------|
| **DamageSync.event.ts has massive duplication** | **Critical** | Lines 161-256: The damage application logic for FFA, Gun Game, and Hopouts is copy-pasted 3 times with near-identical code. Only the death handler call differs (`handleFfaDeath` vs `handleGunGameDeath` vs `handleArenaDeath`). This is the #1 bug risk in the codebase — a damage formula fix must be applied in 3 places. |
| **Stats modules are tightly packed** | Medium | `modules/stats/` contains 12 files covering stats, progression, prestige, leaderboard, profile, challenges, and match history. These are separate concerns sharing a directory. |
| **Season duplicates lifetime stat tracking** | Medium | `SeasonManager.ts` reimplements `updateSeasonalRankedMatchResult()` and `addSeasonalXp()` which mirror `StatsManager` and `ProgressionManager` logic. Changes to MMR formula or XP curve must be applied in both places. |
| **Freeroam mode is empty** | Low | `modes/freeroam/` contains only `.gitkeep`. Freeroam logic is scattered across event handlers. |
| **Admin logs are in-memory only** | Medium | `AdminLog.manager.ts` stores up to 5000 entries in a JS array. Server restart loses all logs. |

---

## SECTION 3 — UI ARCHITECTURE

### 3.1 React UI Structure

**Framework:** React 18 + MobX + Vite + SCSS Modules
**State Management:** MobX (13 stores)
**Routing:** Custom page registry (`registerComponent.ts` + `PageContext.tsx`)
**Styling:** SCSS Modules per component + global `vars.scss`

### 3.2 Page Registry

Pages self-register via `createComponent({ pageName, component, props })` and are loaded eagerly via:
```ts
// pages/index.ts
import.meta.glob("./*/*.tsx", { eager: true });
```

**Registered pages:** auth, selectcharacter, creator, hud, mainmenu, arena_hud, arena_lobby, arena_voting, ffa_hud, ffa_lobby, gungame_hud, gungame_lobby, wardrobe, clothing, admin, settings, playerMenu, report, readycheck, tuner

### 3.3 MobX Stores (13 total)

| Store | Used By | Purpose |
|-------|---------|---------|
| `Arena.store` | ArenaHud, Lobby, Voting, Scoreboard | Match state, kills, rounds, vitals |
| `Player.store` | MainMenu, ArenaHud, FfaHud, GunGameHud, PlayerMenu | Player data, settings |
| `Party.store` | MainMenu, PartyPanel, QueueCard | Party state, invites |
| `Hud.store` | MainHud, ArenaHud | HUD display data |
| `Chat.store` | Chat | Chat messages |
| `Ffa.store` | FfaHud, FfaLobby | FFA match state |
| `GunGame.store` | GunGameHud, GunGameLobby | Gun Game state |
| `Match.store` | ReadyCheck | Ready check state |
| `Ranking.store` | LobbyShell, Challenges, ProfileStats, SeasonRewards | Leaderboard, profile, challenges, season |
| `Wardrobe.store` | Wardrobe, ClothingPanel | Clothing data |
| `CharCreator.store` | Creator, Appearance, FaceFeatures, GeneralData | Character creation |
| `PlayerList.store` | PartyPanel, PlayerMenu | Online player list |
| `Nativemenu.store` | NativeMenu | GTA-style menu data |

### 3.4 Key Findings — UI Architecture

| Finding | Severity | Detail |
|---------|----------|--------|
| **V0 design was never ported** | Info | The V0-generated components (navigation.tsx, play-hub.tsx, loadout-page.tsx, etc.) were never integrated. Only the color palette was extracted to SCSS variables. Current UI uses the original component structure. |
| **Dual color system in vars.scss** | Medium | `vars.scss` defines TWO complete color palettes: the original purple theme (`$accent: #591b87`, `$global-color: #0a0a0e`) AND the V0 teal theme (`$v0-accent: #00e0c6`, `$v0-bg: #0a0f16`). Components use a mix of both. |
| **Monolithic SCSS file** | Medium | `mainmenu.module.scss` is 1424 lines covering lobby, queue card, leaderboard, loadout, challenges, season rewards, profile stats, and more. This single file styles 8+ distinct views. |
| **Arena store is a god object** | High | `Arena.store.ts` is 437 lines with 30+ observable fields and 25+ event handlers registered in the constructor. It manages lobby, match, rounds, kills, vitals, spectating, damage numbers, death overlay, zone, items, scoreboard, and more — all in one class. |
| **Event handler leak risk** | High | `Arena.store` registers 25+ handlers in its constructor but has no cleanup/dispose method. If the store is ever reinstantiated, handlers will duplicate. The `_arenaDeathTimeouts` array of `setTimeout` IDs could accumulate if not properly cleared. |
| **store vs stores directory** | Low | Path alias `store/*` maps to `src/stores/` (with 's'). An empty `src/store/` directory also exists with `.gitkeep`. Confusing for developers. |

---

## SECTION 4 — UI / SERVER COMMUNICATION

### 4.1 Event Flow Diagram

```
SERVER                          CLIENT                         CEF (React)
  │                               │                              │
  │ RAGERP.cef.emit(player,      │                              │
  │   "arena","matchUpdate",data) │                              │
  │──────────────────────────────→│ Browser.processEvent(        │
  │                               │   "cef::arena:matchUpdate",  │
  │                               │   data)                      │
  │                               │─────────────────────────────→│
  │                               │                              │ EventManager
  │                               │                              │ .callHandler(
  │                               │                              │   "arena:matchUpdate",
  │                               │                              │   data)
  │                               │                              │
  │                               │                              │ Store updates
  │                               │                              │ → React re-render
  │                               │                              │
  │                               │     EventManager.emitServer( │
  │                               │←─────"mainmenu","playArena", │
  │                               │       {mode,size})           │
  │                               │                              │
  │  mp.events.callRemote(        │                              │
  │←──"server::mainmenu:playArena"│                              │
  │   {mode, size})               │                              │
```

### 4.2 Key Findings — Communication

| Finding | Severity | Detail |
|---------|----------|--------|
| **UI contains no gameplay logic** | Good | The UI is purely presentational. All damage, health, kill, and match logic runs on the server. The UI only displays data pushed to it. |
| **Client-side damage detection feeds server** | By Design | Client detects hit bones via raycasting (`DamageSync.module.ts`) and sends `server:PlayerHit(remoteId, bone, weaponHash)`. Server validates and applies damage. This is standard for RageMP but means client-side hit detection is trusted for bone selection. |
| **Vitals pushed every frame** | **High** | `Render.event.ts` pushes health/armor to CEF via `Browser.processEvent` on EVERY RENDER FRAME. This is ~60 calls/second per player for data that changes infrequently. |
| **JSON serialization overhead** | Medium | All CEF↔Client communication uses `JSON.stringify`/`JSON.parse`. High-frequency events (vitals, minimap data) serialize/deserialize every frame. |
| **No event batching** | Medium | Each piece of data (health, armor, weapon, ammo, zone name, player count) is sent as a separate event. No batching mechanism exists. |
| **`any` types on event data** | Medium | Most event handlers use `(data: any)` typing. No runtime validation of event payloads. Malformed data from server will cause silent UI bugs. |

---

## SECTION 5 — PERFORMANCE RISKS

### 5.1 Critical Performance Issues

| Issue | Impact | Location |
|-------|--------|----------|
| **Per-frame vitals push** | UI lag, CPU waste | `client/clientevents/Render.event.ts` — `pushVitalsToCefEveryFrame()` sends health+armor to CEF every render tick (~60/s). Should throttle to 100-200ms intervals or only on change. |
| **`setTimeout` accumulation in ArenaStore** | Memory leak | `Arena.store.ts` — `_arenaDeathTimeouts` array stores timeout IDs. While `clearArenaDeathOverlay()` clears them, rapid events (death → round start → death) can accumulate before cleanup runs. Each `damageNumber`, `damageDirection`, `roundResult`, `lastAlive`, and `deathRecap` event pushes a new timeout. |
| **MobX re-renders on every vitals update** | Unnecessary re-renders | `Arena.store.vitals` is observed. Every frame's vitals push triggers MobX reactions across all observing components (ArenaHud, PersonalVitals, TeamVitals). |
| **Eager page loading** | Initial load time | `import.meta.glob("./*/*.tsx", { eager: true })` loads ALL page components at startup, even if the player never visits admin panel, creator, etc. |
| **In-memory admin logs (5000 cap)** | Memory pressure | `AdminLog.manager.ts` stores damage and kill logs in arrays. With 32 players at high fire rates, 5000 entries fill in minutes. |
| **`killFeed` array grows per match** | Minor | `Arena.store.killFeed` is sliced to 8 entries, which is fine. But `damageNumbers` array uses `filter` to remove expired entries, creating new arrays on every removal. |
| **No event debouncing on minimap** | CPU waste | `arena:setMinimapData` sends x/y/heading on every server tick. No client-side throttle before pushing to CEF. |

### 5.2 Matchmaking Performance

The matchmaking system is simple queue-based (not MMR-matched). No expensive loops or algorithms detected. The `isQueueFull` check is O(1). This is performant.

---

## SECTION 6 — UI DESIGN CONSISTENCY

### 6.1 Color System Conflict

The `vars.scss` file defines two complete, incompatible color systems:

**Original Theme (Purple):**
```scss
$accent: #591b87;
$accent-light: #7b3fa0;
$global-color: #0a0a0e;
$hud-accent: $accent;          // Purple
```

**V0 Theme (Teal):**
```scss
$v0-accent: #00e0c6;
$v0-bg: #0a0f16;
$v0-panel: #111922;
$v0-admin-accent: #2ecc71;
```

### 6.2 Which Components Use Which Theme

| Component | Theme Used | Notes |
|-----------|-----------|-------|
| MainMenu (LobbyShell) | **V0 teal** | Full V0 palette throughout |
| QueueCard | **V0 teal** | V0 variables |
| Leaderboard | **V0 teal** | V0 variables |
| Profile Stats | **V0 teal** | V0 variables |
| Challenges | **V0 teal** | V0 variables |
| Season Rewards | **V0 teal** | V0 variables |
| Arena HUD | **Mixed** | Uses `$hud-*` vars (purple-based) + some V0 |
| FFA HUD | **Mixed** | Likely follows Arena HUD pattern |
| Gun Game HUD | **Mixed** | Likely follows Arena HUD pattern |
| Freeroam HUD | **Original purple** | Uses `$hud-*` variables |
| Auth screen | **Original** | auth.module.scss |
| Creator | **Original** | creator.module.scss |
| Wardrobe | **Original** | wardrobe.module.scss |
| Chat | **Original** | chat.module.scss |
| Admin Panel | **V0 teal** | Uses `$v0-admin-accent` |
| Settings | **Original** | settings.module.scss |

### 6.3 Design Inconsistencies

| Issue | Detail |
|-------|--------|
| **Two accent colors** | Menu buttons use teal `#00e0c6`, HUD elements use purple `#591b87`. Player sees both in the same session. |
| **Two background colors** | Menu uses `#0a0f16` (dark navy), HUD uses `#0a0a0e` (near black). Subtle but noticeable on transitions. |
| **Font inconsistency** | `$global-font: "Poppins"` used in some areas, `$display-font: "Beast Duh"` in others, and the mainmenu SCSS hardcodes `-apple-system, BlinkMacSystemFont`. |
| **No design token system** | Colors are defined as variables but there's no semantic layer (e.g., `$color-primary`, `$color-surface`). Components reference raw palette values. |
| **Hardcoded colors** | Multiple SCSS files contain hardcoded hex values (`#878787`, `#EDEDED`, `#FFB74D`, `#FF5E5E`) instead of using variables, making theme changes require manual search-and-replace. |

---

## SECTION 7 — DEAD OR UNUSED CODE

### 7.1 Confirmed Dead/Legacy Code

| Item | Location | Status |
|------|----------|--------|
| **Re-export shim files** | `server/arena/Arena.module.ts`, `ArenaConfig.ts`, `ArenaPresets.asset.ts`, `ArenaMatch.manager.ts`, `ZoneSystem.ts` | These 5+ files in `/arena/` are pure re-exports from `/modes/hopouts/`. They add indirection and exist only for "backward compatibility" during a migration that appears complete. |
| **Empty `store/` directory** | `frontend/src/store/.gitkeep` | Empty directory alongside the actual `stores/` directory. Confusing. |
| **Empty shared directories** | `shared/dto/`, `shared/config/`, `shared/constants/`, `shared/events/`, `shared/enums/`, `shared/schemas/` | All contain only `.gitkeep`. These were set up for a shared contract system that was never implemented. |
| **V0 design components** | Never created in codebase | The V0-generated components (navigation.tsx, play-hub.tsx, etc.) were never added to the repo. Only the color palette was extracted. No dead V0 files to remove. |
| **Freeroam mode** | `modes/freeroam/.gitkeep` | Empty mode directory. Freeroam logic lives in event handlers, not as a mode. |
| **Commented-out test data** | `Player.store.ts:46-48` | Commented-out character mock data left in the store. |
| **Documentation audit files in UI** | `mainmenu/PARTY_UI_AUDIT.md`, `PARTY_INVITE_FLOW.md`, `PARTY_UI_WIRING.md` | Markdown audit docs living alongside React components in the frontend source. Should be in a `docs/` directory. |
| **Multiple system docs in server** | `PARTY_HARDENING_PASS.md`, `PARTY_QUEUE_INTEGRATION.md`, `MATCH_SYSTEM_NOTES.md`, `HOPOUTS_MIGRATION_NOTES.md`, `GUNGAME_MODE_SYSTEM.md` | Scattered across module directories. |
| **`bankData` in Player.store** | `Player.store.ts:14-18` | Bank account data with hardcoded test values. Likely from an RP framework origin — not relevant to PvP arena. |
| **`wantedLevel` in Player.store** | `Player.store.ts:36` | GTA wanted level (hardcoded to 5) — not used in PvP arena context. |
| **Native menu system** | `hud/Nativemenu/`, `Nativemenu.store.ts` | GTA-style native menu system that may be from the RP framework base. Unclear if actively used. |
| **Tuner page** | `pages/tuner/` | Vehicle tuner page — relevance to PvP arena unclear. |

### 7.2 Potentially Unused Imports/Systems

| Item | Notes |
|------|-------|
| `Bank.entity.ts` | Bank entity in database — RP framework remnant? |
| `Vehicle.entity.ts` + `Vehicle.assets.ts` | Vehicle management — only relevant if freeroam uses personal vehicles |
| `InteractablePed` system | NPC interaction — limited PvP relevance |
| `IdleCamera.module.ts` | Vehicle showcase camera — unclear usage |
| `ShootingRange.module.ts` | Shooting range mechanics — may or may not be active |

---

## SECTION 8 — LONG TERM RISK AREAS

### 8.1 Top Risks Ranked by Impact

| # | Risk | Likelihood | Impact | Detail |
|---|------|-----------|--------|--------|
| 1 | **Triplicated damage logic breaks on update** | Very High | Critical | `DamageSync.event.ts` has the same 25-line damage calculation block copy-pasted for FFA, Gun Game, and Hopouts. Any bug fix or balance change must be applied 3 times identically. |
| 2 | **Stringly-typed events cause silent failures** | High | High | No shared enum for event names. A typo in `"arena"` or `"matchUpdate"` fails silently. Adding a new event requires changes in 3+ files with string matching. |
| 3 | **Per-frame CEF updates cause FPS drops** | High | High | Every render frame pushes vitals to CEF + triggers MobX reactions + React re-renders. On lower-end PCs this will cause stutter during combat. |
| 4 | **ArenaStore god object becomes unmaintainable** | Medium | High | 30+ observable fields, 25+ event handlers, and growing. Every new arena feature adds to this single class. |
| 5 | **Seasonal stat logic diverges from lifetime** | Medium | High | `SeasonManager` reimplements MMR and XP logic. If the formulas are tuned in `StatsManager`/`ProgressionManager` but not in `SeasonManager`, seasonal and lifetime stats will calculate differently. |
| 6 | **No event payload validation** | Medium | Medium | Server data is trusted and cast directly to store properties. A server-side change that alters a payload shape will cause runtime errors in the UI with no useful error message. |
| 7 | **In-memory admin logs lost on restart** | Medium | Medium | Damage/kill logs for admin review are stored in RAM. A server crash loses all evidence for admin disputes. |
| 8 | **Client bone detection trusted by server** | Low | High | The client tells the server which bone was hit. While the server validates distance and fire rate, it doesn't independently verify the bone claim. A modified client could always report headshots. |
| 9 | **Mixed color themes create visual inconsistency** | High | Low | Two color systems (purple HUD + teal menus) create a disjointed visual experience. Not a stability risk but affects perceived quality. |
| 10 | **Mode-specific code not isolated** | Medium | Medium | `MainMenu.event.ts` directly imports and calls into all 3 modes. Adding a new mode requires modifying the central menu event handler. |

---

## SECTION 9 — SAFE IMPROVEMENT ROADMAP

### Phase 1: Immediate Stability (No Refactor, Bug Prevention)

**1.1 Extract shared damage calculation function** (DamageSync.event.ts)
- Create a single `calculateModeDamage(finalDamage, weaponHash, mode)` function
- FFA, Gun Game, Hopouts, and Freeroam branches each call it
- The death handler remains mode-specific
- **Risk: Very Low** — pure extraction, no behavior change
- **Impact: Eliminates #1 risk**

**1.2 Throttle vitals push to CEF**
- In `Render.event.ts`, only push health/armor when the value has changed, or at most every 100ms
- Add a simple `lastPushedHealth`/`lastPushedArmor` comparison
- **Risk: Very Low** — only changes update frequency, not data
- **Impact: Significant FPS improvement**

**1.3 Add event name constants file**
- Create `shared/events/EventNames.ts` with const strings
- Gradually adopt in new code (don't rewrite existing files immediately)
- **Risk: None** — additive only

### Phase 2: Code Hygiene (Low Risk)

**2.1 Clean up re-export shim files**
- Update all imports to point directly to `modes/hopouts/` instead of through `arena/`
- Remove the 6 re-export files in `server/arena/` (keep `WeaponAttachments.data.ts` and `WeaponPresets.service.ts` which are actual implementations)
- **Risk: Low** — import path changes only

**2.2 Move documentation files**
- Move `PARTY_UI_AUDIT.md`, `PARTY_INVITE_FLOW.md`, etc. to a `docs/` directory
- Remove empty `.gitkeep` directories in `shared/`
- Remove empty `src/store/` directory
- **Risk: None**

**2.3 Remove RP framework remnants from Player.store**
- Remove `bankData`, `wantedLevel` defaults if confirmed unused
- **Risk: Low** — verify no component reads these before removing

### Phase 3: Architecture Improvements (Medium Risk, High Value)

**3.1 Split Arena.store into focused stores**
- `ArenaMatchStore` — match state, rounds, scores
- `ArenaHudStore` — vitals, damage numbers, kill feed, spectating
- `ArenaLobbyStore` — lobby state, voting, ready check
- Stores can cross-reference each other
- **Risk: Medium** — requires updating component imports
- **Impact: Maintainability of arena UI**

**3.2 Unify seasonal and lifetime stat calculations**
- Extract MMR calculation into a shared function used by both `StatsManager` and `SeasonManager`
- Extract XP calculation into a shared function used by both `ProgressionManager` and `SeasonManager`
- **Risk: Low** — pure extraction
- **Impact: Eliminates stat divergence risk**

**3.3 Add mode registry for MainMenu**
- Instead of `MainMenu.event.ts` importing all modes directly, create a simple mode registry:
  ```ts
  const modes = { hopouts: { join, leave }, ffa: { join, leave }, gungame: { join, leave } };
  ```
- New modes register themselves instead of modifying the menu handler
- **Risk: Low** — encapsulation change
- **Impact: Clean mode addition path**

### Phase 4: Future UI Redesign Preparation

**4.1 Consolidate to a single color system**
- Decide: V0 teal or original purple (or something new)
- Replace all hardcoded hex values with SCSS variables
- Create semantic tokens (`$color-primary`, `$color-surface`, `$color-danger`, etc.)
- **Risk: Low** — visual-only changes

**4.2 Break up monolithic SCSS**
- Split `mainmenu.module.scss` (1424 lines) into per-view stylesheets
- Each component (`Challenges.tsx`, `ProfileStats.tsx`, etc.) gets its own `.module.scss`
- **Risk: Low** — styling-only changes

**4.3 Lazy-load non-critical pages**
- Replace eager glob with lazy imports for admin, creator, wardrobe, settings
- Keep critical paths (hud, arena, mainmenu) eager
- **Risk: Low** — standard Vite code splitting

### Phase 5: Long-Term Hardening

**5.1 Add event payload validation**
- Use Zod or similar for runtime validation of server→UI event data
- Start with high-traffic events (`matchUpdate`, `setVitals`, `killFeed`)

**5.2 Persist admin logs to database**
- Write damage/kill logs to a database table
- Keep in-memory cache for fast queries, flush to DB periodically

**5.3 Add server-side bone validation**
- Cross-reference client-reported bone with shooter→victim angle and weapon type
- Flag statistically impossible headshot rates

---

## TOP 10 ISSUES TO FIX FIRST

Prioritized by: likelihood of causing bugs or instability in production.

| Priority | Issue | Type | File(s) | Fix Effort |
|----------|-------|------|---------|------------|
| **1** | **Triplicated damage logic in DamageSync.event.ts** | Bug Risk | `serverevents/DamageSync.event.ts:161-256` | 1-2 hours — extract shared function |
| **2** | **Per-frame vitals push to CEF** | Performance | `client/clientevents/Render.event.ts` | 30 min — add change detection or 100ms throttle |
| **3** | **Arena.store setTimeout accumulation** | Memory Leak | `stores/Arena.store.ts` — `_arenaDeathTimeouts` | 1 hour — use a managed timer system or clear on state transitions |
| **4** | **Seasonal stat formulas duplicated from lifetime** | Data Integrity | `modules/seasons/SeasonManager.ts` vs `modules/stats/StatsManager.ts` + `ProgressionManager.ts` | 2 hours — extract shared calculation functions |
| **5** | **Stringly-typed event names (no constants)** | Silent Bug Risk | All event handlers across server, client, CEF | 2-3 hours — create shared constants file, adopt incrementally |
| **6** | **No event payload type safety** | Runtime Error Risk | All MobX stores, all event handlers | 3-4 hours — add Zod schemas for critical events |
| **7** | **MobX over-rendering from vitals observable** | Performance | `Arena.store.ts:126` — `vitals` observable triggers full reaction chain | 1 hour — separate frequently-changing data from stable data |
| **8** | **Dual color system causing visual inconsistency** | UX Quality | `styles/vars.scss`, all `.module.scss` files | 3-4 hours — consolidate to one palette, replace hardcoded colors |
| **9** | **In-memory admin logs (5000 cap, lost on restart)** | Data Loss | `admin/AdminLog.manager.ts` | 2-3 hours — add periodic DB flush |
| **10** | **Re-export shim files adding import confusion** | Developer Experience | `server/arena/Arena.module.ts` + 5 more re-export files | 1-2 hours — update import paths, delete shims |

---

## SUMMARY

The Rage Arena codebase is **functional and well-structured for its current scope**. The module-based organization is clean, game modes are properly separated, and the server-authoritative damage model is correct. The MobX + SCSS Module approach for the UI is reasonable for a CEF overlay.

The primary risks are:
1. **Copy-pasted damage logic** that will diverge on the next balance change
2. **Per-frame CEF updates** that will cause performance issues as the UI grows
3. **A growing god-object Arena store** that will become unmaintainable
4. **Two color systems** that create visual inconsistency

None of these require a rewrite. All can be addressed incrementally with the phased roadmap above. The highest-impact fix (extracting the damage calculation function) can be done in under 2 hours with zero risk to existing behavior.
