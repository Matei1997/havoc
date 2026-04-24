# Hopouts PvP — Architecture Audit & Migration Plan

## 1. Architecture Audit

### Current State Summary

The codebase lives under `gamemode-2/gamemode/` and is a RageMP TypeScript project originally scaffolded from an RP framework. The arena/PvP systems have been bolted on and are the active focus. Many RP-era systems remain as dead weight (inventory UI, character slots, RP-style bank, faction chat colors, etc.) while the core PvP loop (queue → lobby → voting → match → rounds → zone → death → results) is functional and well-structured.

### Classification of Every File

#### SERVER — Infrastructure / Core

| File | Role | Keep | Notes |
|------|------|------|-------|
| `server/index.ts` | Entry point, imports all modules | KEEP | Will become thinner as modules self-register |
| `server/api/index.ts` | `RAGERP` namespace — database, cef, commands, pools, utils | KEEP | Rename namespace to something PvP-relevant (e.g. `PVP` or `Arena`) |
| `server/classes/CEFEvent.class.ts` | Server→CEF event bridge | CORE | Reusable infrastructure |
| `server/classes/Command.class.ts` | Command registry with admin levels | CORE | Reusable infrastructure |
| `server/classes/Vehicle.class.ts` | Vehicle pool & manager | CORE | Used by arena (spawn cars) + freeroam |
| `server/classes/Point.class.ts` | Dynamic 3D points | CORE | Generic utility |
| `server/classes/Interaction.class.ts` | Interaction prompts | LOW-PRI | RP-era, not used by arena |
| `server/classes/InteractionProgress.class.ts` | Progress bar interactions | LOW-PRI | RP-era, not used by arena |
| `server/classes/NativeMenu.class.ts` | Native menu builder | LOW-PRI | RP-era, used minimally |
| `server/database/Database.module.ts` | TypeORM DataSource | CORE | Keep, clean up beta flag |
| `server/database/Logger.module.ts` | DB query logger | CORE | Keep |
| `server/prototype/Player.prototype.ts` | Player MP extensions | CORE | Keep, may need cleanup |
| `server/modules/Chat.module.ts` | Chat formatting & commands | CORE | Keep |
| `server/modules/Attachments.module.ts` | Object attachments on entities | KEEP | Used for weapons-on-body visual |
| `server/admin/AdminLog.manager.ts` | In-memory damage/kill log ring buffer | CORE | Keep |
| `server/assets/Weapons.assets.ts` | Weapon hash map | CORE | Used everywhere |
| `server/assets/PlayerSpawn.asset.ts` | Spawn position constants | KEEP | Legion Square default |
| `server/assets/Vehicle.assets.ts` | Vehicle data | KEEP | |
| `server/assets/Admin.asset.ts` | Admin teleport locations | KEEP | |
| `server/@types/index.d.ts` | Player MP type extensions | CORE | Keep |

#### SERVER — Arena / PvP (Active Systems)

| File | Role | Classification | Notes |
|------|------|---------------|-------|
| `server/arena/Arena.module.ts` | Queue + lobby + voting + match launch | **MATCH INFRA** + Hopouts-specific voting | Split: generic queue/matchmaking vs Hopouts map voting |
| `server/arena/ArenaMatch.manager.ts` | Match lifecycle, rounds, spawning, scoring, spectate | **MATCH INFRA** + Hopouts specifics | Core match state machine is reusable; weapon rotation, consumables, effective HP are Hopouts-specific |
| `server/arena/ZoneSystem.ts` | Shrinking zone with phases + OOB damage | **HOPOUTS MODE** | Only Hopouts uses shrinking zones |
| `server/arena/ArenaConfig.ts` | All balance constants | **HOPOUTS MODE** | Round count, zone phases, damage multipliers — all Hopouts tuning |
| `server/arena/ArenaPresets.asset.ts` | JSON file read/write for map presets | **MAP DATA** | Reusable across modes |
| `server/arena/ArenaPreset.interface.ts` | IArenaPreset type definition | **MAP DATA** | Reusable |
| `server/arena/WeaponPresets.service.ts` | Load/save player weapon component presets from DB | **LOADOUT MODULE** | Reusable across all modes |
| `server/arena/WeaponAttachments.data.ts` | Weapon metadata + component recoil data | **LOADOUT MODULE** | Reusable |

#### SERVER — Event Handlers

| File | Classification | Notes |
|------|---------------|-------|
| `serverevents/Arena.event.ts` | PvP — queue/vote/item CEF handlers | Hopouts-specific (consumable cast logic) |
| `serverevents/Death.event.ts` | CORE — routes death to arena or freeroam | Keep, mode-agnostic routing |
| `serverevents/Death.utils.ts` | Injury state utility | RP-legacy (injured state) |
| `serverevents/DamageSync.event.ts` | CORE PvP — server-authoritative damage | Critical; arena damage caps are Hopouts-specific |
| `serverevents/Auth.event.ts` | CORE — login/register | Keep |
| `serverevents/Character.event.ts` | CORE — character spawn/select | Keep, simplify (only 1 char needed for PvP) |
| `serverevents/Player.event.ts` | CORE — join/quit/spectate/noclip | Keep |
| `serverevents/MainMenu.event.ts` | PvP — play arena / play freeroam handlers | Keep, this is the main game flow |
| `serverevents/PlayerMenu.event.ts` | UI — player list | Keep |
| `serverevents/Chat.event.ts` | CORE — chat processing | Keep |
| `serverevents/Voice.event.ts` | CORE — voice proximity + team radio | Keep |
| `serverevents/Vehicle.event.ts` | Vehicle event handlers | Keep if vehicles used in arena |
| `serverevents/Point.event.ts` | Dynamic point handlers | Low-pri, RP-era |
| `serverevents/Wardrobe.event.ts` | Clothing save/load/preview | KEEP — used for clothing customization |
| `serverevents/Admin.event.ts` | Admin panel CEF handlers | Keep |
| `serverevents/Report.event.ts` | Report system handlers | Keep |

#### SERVER — Commands

| File | Classification | Notes |
|------|---------------|-------|
| `commands/index.ts` | Barrel import | Keep |
| `commands/Admin.commands.ts` | Admin tools (goto, spec, ban, esp, gm, logs) | KEEP |
| `commands/Dev.commands.ts` | Dev/testing (pos, tp, kill, weapon give) | KEEP for dev |
| `commands/ArenaDev.commands.ts` | Arena map creation tools + solo match + freeroam cmds | KEEP |
| `commands/Freeroam.commands.ts` | Freeroam mode commands (fdim, fveh, fgun) | KEEP — freeroam mode |
| `commands/Player.commands.ts` | Player commands | Keep |

#### SERVER — Database Entities

| Entity | Classification | Notes |
|--------|---------------|-------|
| `Account.entity.ts` | CORE | Keep |
| `Character.entity.ts` | CORE but bloated | Contains RP fields (wantedLevel, deathState, cash, bank relation). Simplify for PvP |
| `Vehicle.entity.ts` | LOW-PRI | Only needed if persistent vehicle ownership exists |
| `Ban.entity.ts` | CORE | Keep |
| `Bank.entity.ts` | RP-LEGACY | Remove — PvP doesn't need bank accounts |
| `WeaponPreset.entity.ts` | PvP CORE | Loadout persistence — keep |

#### CLIENT — Modules

| File | Classification | Notes |
|------|---------------|-------|
| `modules/DamageSync.module.ts` | CORE PvP | Client-side hit detection → server |
| `modules/Hitmarker.module.ts` | CORE PvP | Floating damage numbers + outgoing damage cancel |
| `modules/ArenaZone.module.ts` | HOPOUTS | Zone rendering on minimap/screen |
| `modules/ArenaMinimap.module.ts` | HOPOUTS | Custom minimap for arena |
| `modules/ArenaRadar.module.ts` | HOPOUTS | Radar rendering |
| `modules/ArenaVitals.module.ts` | PvP | Health/armor UI bridge |
| `modules/Recoil.module.ts` | PvP | Custom recoil system with attachment modifiers |
| `modules/WeaponDraw.module.ts` | PvP | Weapon equip animations |
| `modules/WeaponsOnBody.module.ts` | PvP | Visual weapons on player model |
| `modules/LocalVoice.module.ts` | CORE | Proximity + team voice |
| `modules/ClothesSync.module.ts` | CORE | Syncs clothes across clients |
| `modules/Nametag.module.ts` | CORE | Player nametags |
| `modules/Compass.module.ts` | PvP | Compass HUD element |
| `modules/Crouch.module.ts` | PvP | Crouch mechanic |
| `modules/HudColor.module.ts` | CORE | HUD color management |
| `modules/Keybinding.module.ts` | CORE | Keybind system |
| `modules/Speedometer.module.ts` | CORE | Vehicle speedometer |
| `modules/VehicleDamage.module.ts` | CORE | Vehicle damage sync |
| `modules/Noclip.module.ts` | ADMIN | Admin noclip |
| `modules/AdminESP.module.ts` | ADMIN | Admin ESP overlay |
| `modules/IdleCamera.module.ts` | UI | Auth screen camera |
| `modules/MainMenuScene.module.ts` | UI | Main menu scene |
| `modules/ShootingRange.module.ts` | FREEROAM | Shooting range targets |
| `modules/WardrobeCamera.module.ts` | UI | Wardrobe camera |
| `modules/AttachEditor.module.ts` | DEV | Attachment position editor |
| `modules/GameData.module.ts` | CORE | Game data bridge |

#### CLIENT — Classes

| File | Classification | Notes |
|------|---------------|-------|
| `classes/Browser.class.ts` | CORE | CEF browser wrapper |
| `classes/Camera.class.ts` | CORE | Camera management |
| `classes/Chat.class.ts` | CORE | Chat input/output |
| `classes/Client.class.ts` | CORE | Client initialization |
| `classes/Hud.class.ts` | CORE | HUD management |
| `classes/Keybind.class.ts` | CORE | Keybind registry |
| `classes/Spectate.class.ts` | PvP | Spectate camera system |
| `classes/Vehicle.class.ts` | CORE | Client vehicle class |
| `classes/Attachments.class.ts` | CORE | Object attachment rendering |
| `classes/Creator.class.ts` | CORE | Character creator camera |
| `classes/InteractablePed.class.ts` | RP-LEGACY | NPC interaction — not used in PvP |
| `classes/Raycast.class.ts` | UTILITY | Raycast helper |

#### FRONTEND — Pages

| File | Classification | Notes |
|------|---------------|-------|
| `pages/mainmenu/MainMenu.tsx` | PvP CORE | Main game hub — play, loadout, clothing, ranking |
| `pages/arena/ArenaHud.tsx` | PvP CORE | In-match HUD (scores, zone, kills, items, compass) |
| `pages/arena/Lobby.tsx` | PvP | Queue lobby UI |
| `pages/arena/Voting.tsx` | HOPOUTS | Map voting UI |
| `pages/loadout/LoadoutPanel.tsx` | PvP | Weapon attachment loadout |
| `pages/clothing/ClothingPanel.tsx` | PvP | Outfit customization |
| `pages/auth/Authentication.tsx` | CORE | Login/register |
| `pages/auth/components/*` | CORE | Auth form components |
| `pages/creator/Creator.tsx` | CORE | Character creation |
| `pages/hud/Hud.tsx` | CORE | Freeroam HUD wrapper |
| `pages/hud/Chat/*` | CORE | Chat UI |
| `pages/hud/MainHud/*` | CORE | Freeroam HUD + speedometer |
| `pages/hud/DeathScreen/*` | RP-LEGACY | RP death screen (injured state) |
| `pages/hud/InteractButton/*` | RP-LEGACY | Interaction button |
| `pages/hud/InteractionMenu/*` | RP-LEGACY | Radial interaction menu |
| `pages/hud/Nativemenu/*` | RP-LEGACY | Native menu rendering |
| `pages/admin/AdminPanel.tsx` | ADMIN | Admin panel |
| `pages/report/Report.tsx` | CORE | Report UI |
| `pages/selectcharacter/*` | RP-LEGACY | Multi-character select (PvP = 1 char) |
| `pages/wardrobe/Wardrobe.tsx` | KEEP | Wardrobe — merged into clothing flow |
| `pages/playerMenu/PlayerMenu.tsx` | CORE | Online player list |
| `pages/tuner/Tuner.tsx` | RP-LEGACY | Vehicle tuner |
| `pages/SettingsMenu/*` | CORE | Settings (display, keybinds, security) |

#### FRONTEND — Stores

| File | Classification | Notes |
|------|---------------|-------|
| `stores/Arena.store.ts` | PvP CORE | Match state, lobby, zone, kills, items |
| `stores/Player.store.ts` | CORE | Player data |
| `stores/Chat.store.ts` | CORE | Chat state |
| `stores/Hud.store.ts` | CORE | HUD state (speedometer, etc.) |
| `stores/PlayerList.store.ts` | CORE | Player list state |
| `stores/CharCreator.store.ts` | CORE | Character creator state |
| `stores/Wardrobe.store.ts` | KEEP | Wardrobe state |
| `stores/Nativemenu.store.ts` | RP-LEGACY | Native menu state |

#### SHARED

| File | Classification | Notes |
|------|---------------|-------|
| `shared/index.ts` | CORE but bloated | Contains massive Inventory namespace that's unused. Vehicle enums for tuner. Many RP-era types |
| `shared/utils.module.ts` | CORE | Utility functions |
| `shared/CefData.ts` | CORE | CEF data types |

---

## 2. Old Path → New Path Migration Map

Legend: `[CURRENT]` → `[TARGET]` — `[ACTION]`

### Server Core

```
server/api/index.ts                        → server/core/Api.ts                          — MOVE + rename namespace
server/classes/CEFEvent.class.ts           → server/core/CEFEvent.ts                     — MOVE
server/classes/Command.class.ts            → server/core/Command.ts                      — MOVE
server/classes/Vehicle.class.ts            → server/modules/vehicles/Vehicle.ts           — MOVE
server/classes/Point.class.ts              → server/core/Point.ts                        — MOVE
server/classes/Interaction.class.ts        → ARCHIVE                                     — RP legacy
server/classes/InteractionProgress.class.ts→ ARCHIVE                                     — RP legacy
server/classes/NativeMenu.class.ts         → ARCHIVE                                     — RP legacy
server/prototype/Player.prototype.ts       → server/core/PlayerPrototype.ts              — MOVE
server/modules/Chat.module.ts              → server/core/Chat.ts                         — MOVE
server/modules/Attachments.module.ts       → server/modules/attachments/Attachments.ts   — MOVE
server/index.ts                            → server/index.ts                             — KEEP (update imports)
```

### Server Database

```
server/database/Database.module.ts         → server/database/DataSource.ts               — MOVE
server/database/Logger.module.ts           → server/database/Logger.ts                   — MOVE
server/database/entity/Account.entity.ts   → server/database/entities/Account.entity.ts  — MOVE
server/database/entity/Character.entity.ts → server/database/entities/Character.entity.ts— MOVE + SIMPLIFY
server/database/entity/Ban.entity.ts       → server/database/entities/Ban.entity.ts      — MOVE
server/database/entity/WeaponPreset.entity.ts→server/database/entities/WeaponPreset.entity.ts— MOVE
server/database/entity/Vehicle.entity.ts   → server/database/entities/Vehicle.entity.ts  — MOVE (low-pri)
server/database/entity/Bank.entity.ts      → ARCHIVE                                     — RP legacy
```

### Server Arena → Modules + Modes

```
server/arena/Arena.module.ts               → server/modules/matchmaking/QueueManager.ts  — EXTRACT generic queue logic
                                           + server/modes/hopouts/HopoutsVoting.ts       — EXTRACT map voting
server/arena/ArenaMatch.manager.ts         → server/modules/matches/MatchManager.ts      — EXTRACT generic match lifecycle
                                           + server/modes/hopouts/HopoutsRound.ts        — EXTRACT weapon rotation, consumables
server/arena/ZoneSystem.ts                 → server/modules/zone/ZoneSystem.ts           — MOVE (used by Hopouts, could be reused)
server/arena/ArenaConfig.ts                → server/modes/hopouts/HopoutsConfig.ts       — MOVE (mode-specific tuning)
                                           + shared/config/MatchDefaults.ts              — EXTRACT generic defaults
server/arena/ArenaPresets.asset.ts         → data/arenas/ArenaPresets.service.ts         — MOVE
server/arena/ArenaPreset.interface.ts      → shared/interfaces/ArenaPreset.interface.ts  — MOVE
server/arena/WeaponPresets.service.ts      → server/modules/loadout/WeaponPresets.service.ts — MOVE
server/arena/WeaponAttachments.data.ts     → data/weapons/WeaponAttachments.data.ts      — MOVE
```

### Server Events

```
serverevents/Arena.event.ts                → server/modes/hopouts/HopoutsEvents.ts       — MOVE (consumable logic is Hopouts)
                                           + server/modules/matchmaking/QueueEvents.ts   — EXTRACT queue join/leave
serverevents/Death.event.ts                → server/modules/matches/DeathHandler.ts      — MOVE
serverevents/Death.utils.ts                → ARCHIVE                                     — RP injury state
serverevents/DamageSync.event.ts           → server/modules/matches/DamageSync.ts        — MOVE
                                           + server/modes/hopouts/HopoutsDamage.ts       — EXTRACT arena damage caps
serverevents/Auth.event.ts                 → server/modules/players/Auth.ts              — MOVE
serverevents/Character.event.ts            → server/modules/players/Character.ts         — MOVE
serverevents/Player.event.ts               → server/modules/players/PlayerLifecycle.ts   — MOVE
serverevents/MainMenu.event.ts             → server/modules/lobbies/MainMenu.ts          — MOVE
serverevents/Voice.event.ts                → server/modules/players/Voice.ts             — MOVE
serverevents/Wardrobe.event.ts             → server/modules/clothing/Wardrobe.ts         — MOVE
serverevents/Chat.event.ts                 → server/core/ChatEvent.ts                    — MOVE
serverevents/Vehicle.event.ts              → server/modules/vehicles/VehicleEvents.ts    — MOVE
serverevents/Point.event.ts                → ARCHIVE                                     — RP legacy
serverevents/Admin.event.ts                → server/admin/AdminEvents.ts                 — MOVE
serverevents/Report.event.ts               → server/admin/ReportEvents.ts                — MOVE
serverevents/PlayerMenu.event.ts           → server/modules/players/PlayerMenu.ts        — MOVE
```

### Server Commands

```
commands/Admin.commands.ts                 → server/admin/commands/Admin.commands.ts      — MOVE
commands/Dev.commands.ts                   → server/admin/commands/Dev.commands.ts        — MOVE
commands/ArenaDev.commands.ts              → server/admin/commands/ArenaDev.commands.ts   — MOVE
commands/Freeroam.commands.ts              → server/modes/freeroam/Freeroam.commands.ts  — MOVE
commands/Player.commands.ts                → server/modules/players/Player.commands.ts   — MOVE
commands/index.ts                          → server/commands/index.ts                    — UPDATE imports
```

### Server Admin

```
admin/AdminLog.manager.ts                  → server/admin/logs/AdminLog.manager.ts       — MOVE
```

### Client

```
client/modules/DamageSync.module.ts        → client/gameplay/DamageSync.ts               — MOVE
client/modules/Hitmarker.module.ts         → client/gameplay/Hitmarker.ts                — MOVE
client/modules/ArenaZone.module.ts         → client/gameplay/ArenaZone.ts                — MOVE
client/modules/ArenaMinimap.module.ts      → client/gameplay/ArenaMinimap.ts             — MOVE
client/modules/ArenaRadar.module.ts        → client/gameplay/ArenaRadar.ts               — MOVE
client/modules/ArenaVitals.module.ts       → client/gameplay/ArenaVitals.ts              — MOVE
client/modules/Recoil.module.ts            → client/gameplay/Recoil.ts                   — MOVE
client/modules/WeaponDraw.module.ts        → client/gameplay/WeaponDraw.ts               — MOVE
client/modules/WeaponsOnBody.module.ts     → client/gameplay/WeaponsOnBody.ts            — MOVE
client/modules/Crouch.module.ts            → client/gameplay/Crouch.ts                   — MOVE
client/modules/Compass.module.ts           → client/gameplay/Compass.ts                  — MOVE
client/modules/LocalVoice.module.ts        → client/core/LocalVoice.ts                  — MOVE
client/modules/ClothesSync.module.ts       → client/core/ClothesSync.ts                 — MOVE
client/modules/Nametag.module.ts           → client/core/Nametag.ts                     — MOVE
client/modules/HudColor.module.ts          → client/core/HudColor.ts                    — MOVE
client/modules/Keybinding.module.ts        → client/core/Keybinding.ts                  — MOVE
client/modules/Speedometer.module.ts       → client/core/Speedometer.ts                 — MOVE
client/modules/VehicleDamage.module.ts     → client/core/VehicleDamage.ts               — MOVE
client/modules/Noclip.module.ts            → client/spectate/Noclip.ts                  — MOVE
client/modules/AdminESP.module.ts          → client/spectate/AdminESP.ts                — MOVE
client/modules/IdleCamera.module.ts        → client/camera/IdleCamera.ts                — MOVE
client/modules/MainMenuScene.module.ts     → client/camera/MainMenuScene.ts             — MOVE
client/modules/WardrobeCamera.module.ts    → client/camera/WardrobeCamera.ts            — MOVE
client/modules/ShootingRange.module.ts     → client/gameplay/ShootingRange.ts           — MOVE
client/modules/AttachEditor.module.ts      → client/core/AttachEditor.ts                — MOVE (dev tool)
client/modules/GameData.module.ts          → client/core/GameData.ts                    — MOVE
client/classes/Browser.class.ts            → client/core/Browser.ts                     — MOVE
client/classes/Camera.class.ts             → client/camera/Camera.ts                    — MOVE
client/classes/Chat.class.ts               → client/core/Chat.ts                        — MOVE
client/classes/Client.class.ts             → client/core/Client.ts                      — MOVE
client/classes/Hud.class.ts                → client/core/Hud.ts                         — MOVE
client/classes/Keybind.class.ts            → client/core/Keybind.ts                     — MOVE
client/classes/Spectate.class.ts           → client/spectate/Spectate.ts                — MOVE
client/classes/Vehicle.class.ts            → client/core/Vehicle.ts                     — MOVE
client/classes/Attachments.class.ts        → client/core/Attachments.ts                 — MOVE
client/classes/Creator.class.ts            → client/core/Creator.ts                     — MOVE
client/classes/InteractablePed.class.ts    → ARCHIVE                                    — RP legacy
client/classes/Raycast.class.ts            → client/core/Raycast.ts                     — MOVE
```

### Frontend

```
frontend/src/pages/mainmenu/              → frontend/src/pages/lobby/                   — RENAME
frontend/src/pages/arena/ArenaHud.tsx      → frontend/src/pages/arena/ArenaHud.tsx       — KEEP
frontend/src/pages/arena/Lobby.tsx         → frontend/src/pages/queue/QueueLobby.tsx     — MOVE
frontend/src/pages/arena/Voting.tsx        → frontend/src/pages/queue/Voting.tsx         — MOVE
frontend/src/pages/loadout/               → frontend/src/pages/loadout/                 — KEEP
frontend/src/pages/clothing/              → frontend/src/pages/loadout/ (merge)         — MERGE into loadout
frontend/src/pages/auth/                  → frontend/src/pages/auth/                    — KEEP (rename "auth")
frontend/src/pages/creator/              → frontend/src/pages/auth/creator/             — NEST under auth flow
frontend/src/pages/admin/                → frontend/src/pages/admin/                    — KEEP
frontend/src/pages/report/               → frontend/src/pages/admin/report/             — NEST
frontend/src/pages/playerMenu/           → frontend/src/pages/lobby/PlayerMenu.tsx      — MERGE into lobby
frontend/src/pages/SettingsMenu/         → frontend/src/pages/lobby/Settings.tsx        — MERGE into lobby
frontend/src/pages/wardrobe/             → MERGE into clothing/loadout flow             — MERGE
frontend/src/pages/hud/Chat/             → frontend/src/pages/arena/Chat/               — MOVE
frontend/src/pages/hud/MainHud/          → frontend/src/pages/arena/MainHud/            — MOVE
frontend/src/pages/hud/DeathScreen/      → ARCHIVE                                      — RP legacy
frontend/src/pages/hud/InteractButton/   → ARCHIVE                                      — RP legacy
frontend/src/pages/hud/InteractionMenu/  → ARCHIVE                                      — RP legacy
frontend/src/pages/hud/Nativemenu/       → ARCHIVE                                      — RP legacy
frontend/src/pages/selectcharacter/      → ARCHIVE                                      — RP legacy (auto-select single char)
frontend/src/pages/tuner/               → ARCHIVE                                      — RP legacy
frontend/src/stores/Arena.store.ts       → frontend/src/store/Arena.store.ts            — MOVE
frontend/src/stores/Nativemenu.store.ts  → ARCHIVE                                      — RP legacy
```

### Shared

```
shared/index.ts                           → shared/interfaces/ + shared/enums/          — SPLIT into focused files
shared/utils.module.ts                    → shared/utils.ts                             — MOVE
shared/CefData.ts                         → shared/dto/CefData.ts                       — MOVE
(new)                                     → shared/events/EventNames.ts                 — CREATE: centralized event string constants
(new)                                     → shared/config/MatchDefaults.ts              — CREATE: generic match config
```

### Data

```
data/arenas/*.json                        → data/arenas/                                — KEEP
(from ArenaConfig.ts weapon rotation)     → data/weapons/rotation.json                  — EXTRACT
(from WeaponAttachments.data.ts)          → data/weapons/attachments.json               — EXTRACT
```

---

## 3. Duplicate System Risks

### HIGH RISK — Existing Overlaps

| Risk | Files | Issue |
|------|-------|-------|
| **Queue vs Lobby confusion** | `Arena.module.ts` contains both queue management AND lobby state AND voting | These are 3 distinct responsibilities. When you add parties/custom lobbies, this file will become a mess. Split now. |
| **Damage handling split** | `DamageSync.event.ts` (server) + `DamageSync.module.ts` (client) + `ArenaMatch.manager.ts` (arena HP) | Damage flows through 3 files. Arena-specific damage caps live in DamageSync.event.ts but should be in the Hopouts mode. Generic damage routing should be separate from mode-specific scaling. |
| **Death handling duplication** | `Death.event.ts` (router) + `ArenaMatch.manager.ts` (handleArenaDeath) + `Death.utils.ts` (RP injury) | Death routing works but Death.utils.ts is RP-only dead code. The arena death path lives in the match manager but gets called from the event handler — this coupling is fine but document it. |
| **Spectate system** | `Player.event.ts` (startSpectate/stopSpectate) + `ArenaMatch.manager.ts` (arena spectate) + `Spectate.class.ts` (client) | Two spectate entry points: admin spectate and arena-death spectate. They share the same client class but server-side logic is duplicated. |
| **Player spawn positions** | `PlayerSpawn.asset.ts` + `LEGION_SQUARE` const in `Player.event.ts` + `LEGION_SQUARE` const in `MainMenu.event.ts` | Legion Square spawn position defined in 3 places. Consolidate to one constant. |
| **Weapon data** | `Weapons.assets.ts` (hash map) + `WeaponAttachments.data.ts` (metadata) + `ArenaConfig.ts` (rotation) + `DamageSync.event.ts` (damage values) | Weapon information scattered across 4 files. Should be one authoritative data source. |
| **Clothes/Wardrobe** | `Wardrobe.event.ts` + `ClothesSync.module.ts` (client) + `ClothingPanel.tsx` + `Wardrobe.tsx` + `Wardrobe.store.ts` | Two frontend pages (ClothingPanel in main menu + Wardrobe standalone). Merge into one clothing system. |

### MEDIUM RISK — Future Collision Points

| Risk | Notes |
|------|-------|
| **FFA mode vs Hopouts queue** | When you add FFA, the queue in `Arena.module.ts` assumes 2 teams. FFA needs a different matchmaking path. Extract generic queue interface now. |
| **Gun Game vs weapon rotation** | Gun Game needs per-kill weapon progression, not per-round rotation. If weapon assignment lives inside `ArenaMatch.manager.ts`, Gun Game can't override it cleanly. |
| **Stats system doesn't exist yet** | Kill/death tracking is ephemeral (per-match only). When you add stats/ranked, you'll need a new entity + persistent stat tracking. Plan the `Stats` module slot now. |
| **Party system doesn't exist yet** | Queue currently only accepts solo players. When parties arrive, queue logic needs to accept pre-formed groups. Design the interface now. |

---

## 4. Safe Refactor Order

### Phase 0: Preparation (no behavior changes)
1. **Create the target folder structure** — empty directories matching the target architecture
2. **Add path aliases** to `tsconfig.json` / webpack config for the new paths (e.g., `@core`, `@modules`, `@modes`, `@admin`)
3. **Consolidate duplicate constants** — merge the 3 `LEGION_SQUARE` definitions into one shared constant
4. **Archive dead code** — move unused RP files to an `_archive/` folder (don't delete yet):
   - `Death.utils.ts`, `InteractablePed.class.ts`, `Interaction.class.ts`, `InteractionProgress.class.ts`, `NativeMenu.class.ts`
   - Frontend: `DeathScreen/`, `InteractButton/`, `InteractionMenu/`, `Nativemenu/`, `selectcharacter/`, `tuner/`
   - `Bank.entity.ts` (remove from DataSource entities array)
   - `Nativemenu.store.ts`

### Phase 1: Move Core Infrastructure (low risk)
5. **Move server/core files** — `CEFEvent`, `Command`, `Chat`, `Point`, `PlayerPrototype`, `Api` → `server/core/`
6. **Move database files** — entities + DataSource → `server/database/`
7. **Move shared types** — split `shared/index.ts` into `shared/enums/`, `shared/interfaces/`
8. **Update all imports** — use new path aliases
9. **Build + test** — verify nothing broke

### Phase 2: Move Client + Frontend (medium risk)
10. **Move client modules** to `client/core/`, `client/gameplay/`, `client/camera/`, `client/spectate/`
11. **Move client classes** to their target locations
12. **Move frontend pages** to target structure
13. **Move frontend stores** (rename `stores/` → `store/`)
14. **Build + test**

### Phase 3: Extract Mode-Specific Logic (highest risk)
15. **Extract generic MatchManager** from `ArenaMatch.manager.ts`:
    - Generic: match state machine, round lifecycle, team tracking, scoring, spectate-on-death
    - Hopouts-specific: weapon rotation, consumable counts, effective HP, item cast
16. **Extract generic QueueManager** from `Arena.module.ts`:
    - Generic: queue join/leave, size-based matching, countdown, match launch
    - Hopouts-specific: map voting, preference-based voting
17. **Extract Hopouts damage rules** from `DamageSync.event.ts`:
    - Generic: server-authoritative hit processing, team damage check
    - Hopouts: damage multiplier (0.75), per-weapon caps, effective HP deduction
18. **Create `server/modes/hopouts/`** directory with extracted Hopouts-specific files
19. **Create mode interface** — define `IGameMode` with hooks: `onRoundStart`, `onDeath`, `onDamage`, `getWeapons`, `getConfig`
20. **Build + test thoroughly**

### Phase 4: Data Extraction (low risk)
21. **Move arena presets** to `data/arenas/`
22. **Extract weapon data** into `data/weapons/` JSON files
23. **Move config constants** to `shared/config/`
24. **Build + test**

### Phase 5: Cleanup + Polish
25. **Simplify Character entity** — remove RP fields (wantedLevel, bank relation, cash if not needed)
26. **Rename `RAGERP` namespace** to `PVP` or `Arena` or `Hopouts`
27. **Remove `_archive/` folder** once confident nothing references it
28. **Clean up `shared/index.ts`** — remove unused Inventory namespace, RP-era enums
29. **Add barrel exports** (`index.ts`) to each new directory for clean imports

---

## 5. Legacy Cleanup Recommendations

### Remove Now (Dead Code)
- `Bank.entity.ts` — no PvP use, no references in active code
- `Death.utils.ts` — `setPlayerToInjuredState` is RP injury state, not used in PvP death flow
- `InteractablePed.class.ts` — NPC interaction, never called
- `Interaction.class.ts` + `InteractionProgress.class.ts` — RP interaction prompts
- `NativeMenu.class.ts` + `Nativemenu.store.ts` + `Nativemenu/` frontend — RP native menu system
- Frontend `selectcharacter/` — PvP auto-selects single character on login
- Frontend `tuner/Tuner.tsx` — vehicle tuning shop, RP feature
- Frontend `DeathScreen/` — RP injured screen, arena uses its own death overlay
- Frontend `InteractButton/` + `InteractionMenu/` — RP radial menu
- `Nativemenu.store.ts` — pairs with removed NativeMenu

### Remove After Verification
- `shared/index.ts` → `Inventory` namespace (massive, ~500 lines of unused types)
- `shared/index.ts` → Vehicle tuner enums (`VEHICLEMODS`, `VEHICLE_MOD_NAMES`, `VEHICLE_COLOR_TYPES`)
- `Character.entity.ts` → `wantedLevel`, `deathState` (RP states), `bank` relation, `loadInventory` stub
- Admin commands: `giveclothes`, `giveitem`, `spawnitem` — all return "Inventory system has been removed"
- `serverevents/Point.event.ts` — dynamic point handlers, unclear if used

### Mark as Legacy / Revisit
- `Character.entity.ts` → `cash` field — could be repurposed as in-game currency for cosmetics
- Vehicle persistence system (`Vehicle.entity.ts`, `Vehicle.class.ts`) — only needed if owned vehicles carry between sessions
- `server/report/Report.manager.ts` + `Report.event.ts` — useful but may want Discord webhook integration instead

---

## 6. Questions / Unknowns

1. **Single character per account?** The current system supports 3 character slots but login auto-selects the first. Should we enforce 1 character and simplify the auth→spawn flow?

2. **Cash / Economy system?** `Character.entity.ts` has a `cash` field (default 1500). Is this planned for cosmetic purchases, or is it RP leftover to remove?

3. **Vehicle persistence?** Arena spawns vehicles ephemerally per match. Freeroam has `/fveh`. Do players need persistent owned vehicles, or can we remove `Vehicle.entity.ts`?

4. **Inventory system — fully dead?** All inventory commands return "removed" but the massive `Inventory` namespace in shared types remains. Confirm this is safe to delete entirely.

5. **Weapon rotation per-mode or global?** Currently `WEAPON_ROTATION` in ArenaConfig is Hopouts-only. Will FFA/Gun Game have different weapon sets? This affects whether rotation data lives in mode config or shared data.

6. **Stats persistence priority?** No stats entity exists yet. When you add ranked/stats, you'll need `PlayerStats.entity.ts` with kills, deaths, wins, losses, ELO. Should this be planned in the schema now?

7. **Party system scope?** The main menu UI has "INVITE FRIEND" slots and "YOUR LOBBY" section but no backend. When this is built, queue logic needs to accept pre-formed groups of 2-5. How soon is this needed?

8. **Discord webhook integration?** `discord-webhook-node` is in dependencies. Is this actively used for kill logs / admin actions, or is it RP leftover?

9. **Deployment target?** The build produces `ragemp-server/` output. Is there a CI/CD pipeline, or is deployment manual? This affects how aggressively we can restructure build paths.

10. **Code obfuscation?** `webpack-obfuscator` is configured. Does the production build need obfuscation, and does this constrain how we structure exports?
