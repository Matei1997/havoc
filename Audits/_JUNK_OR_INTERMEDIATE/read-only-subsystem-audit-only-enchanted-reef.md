# Audit Plan: Loadout / Clothing / Vehicles

## Context

This is a read-only audit with no code changes. The only deliverable is
`AUDIT_LOADOUT_CLOTHING_VEHICLES.md` written to the working directory root.
No code edits. No fixes applied.

## Scope Confirmed

Files actually analyzed:
- `gamemode/source/server/arena/WeaponPresets.service.ts`
- `gamemode/source/server/arena/WeaponAttachments.data.ts`
- `gamemode/source/server/prototype/WeaponComponentTintSync.prototype.ts`
- `gamemode/source/server/serverevents/Wardrobe.event.ts`
- `gamemode/source/server/serverevents/Vehicle.event.ts`
- `gamemode/source/server/classes/Vehicle.class.ts`
- `gamemode/source/server/database/entity/Vehicle.entity.ts`
- `gamemode/source/server/database/entity/Character.entity.ts`
- `gamemode/source/server/database/Database.module.ts`
- `gamemode/source/client/modules/WeaponPresetApply.module.ts`
- `gamemode/source/client/modules/WeaponComponentTintSync.module.ts`
- `gamemode/source/client/modules/WeaponDraw.module.ts`
- `gamemode/source/client/modules/WeaponsOnBody.module.ts`
- `gamemode/source/client/modules/WeaponPresetReliability.module.ts`
- `gamemode/source/client/modules/ClothesSync.module.ts`
- `gamemode/source/client/modules/ClothingEditorCamera.module.ts`
- `gamemode/source/client/classes/Creator.class.ts`
- `gamemode/source/client/classes/Vehicle.class.ts` (client)
- `gamemode/source/shared/loadout/weaponRegistry.ts`
- `gamemode/source/shared/clothingEditorRegions.ts`
- `gamemode/source/shared/wardrobeStage.ts`
- `gamemode/source/shared/json/wardrobeBlockedDrawables.json`
- `gamemode/source/shared/vehicleTune/vehicleTuneCatalog.ts`
- `gamemode/frontend/src/stores/Wardrobe.store.ts`
- `gamemode/frontend/src/pages/clothing/ClothingPanel.tsx`
- `gamemode/frontend/src/assets/clothesLimits.ts`

---

## Full Audit Content (to be written verbatim to AUDIT_LOADOUT_CLOTHING_VEHICLES.md)

```
# AUDIT_LOADOUT_CLOTHING_VEHICLES.md
Arena Server — Weapons / Loadout / Clothing / Vehicles
Audit Date: 2026-04-24
Auditor: Claude Code (read-only, no fixes applied)
RAGE:MP doc access: UNAVAILABLE — findings marked [UNVERIFIED AGAINST LIVE DOCS] where relevant
```

---

## 1. CRITICAL FINDINGS

### C-1 · No Server-Side Weapon Whitelist Enforcement
**Files:** `WeaponPresets.service.ts` — `equipToFreeroam`, `equipForEdit`, `savePreset` handlers

The server resolves weapon names to JOAAT hashes and grants them without ever
checking the `WEAPON_REGISTRY.enabled` flag in `shared/loadout/weaponRegistry.ts`.

Attack path:
- Client sends `weaponName: "weapon_rpg"` (or any GTA V weapon string) to `equipToFreeroam`.
- Server calls `resolveWeaponHashFromName()` → valid JOAAT hash.
- Server checks only: hash ≠ unarmed, carry-group returned is "primary"/"sidearm".
- Server grants the weapon unconditionally.

Weapons that fail the carry-group check (e.g., melee, thrown) are blocked
by that indirect guard. Weapons like RPG, grenade launcher, minigun that
return a carry group are NOT blocked. WEAPON_REGISTRY is never consulted.

Identical gap in `savePreset` — weapon name is stored without whitelist check.

---

### C-2 · No Validation of Tint Indices (Server or Client)
**Files:** `WeaponComponentTintSync.prototype.ts` — `setWeaponTint`

`setWeaponTint(hash, tintIndex)` stores whatever integer the client sends.
No range check (GTA V valid range is 0–7 for most weapons, 0–255 for some).
The value propagates to `currentWeaponTint` player variable, is broadcast to
all in-range players, and is applied client-side without clamping.

[UNVERIFIED AGAINST LIVE DOCS] — Exact per-weapon tint limits not confirmed
from live RAGE:MP docs.

---

### C-3 · No Per-Player Vehicle Spawn Limit
**Files:** `Vehicle.event.ts` — `spawnVehicleFromWizard`, `Vehicle.class.ts` constructor

Nothing limits how many freeroam vehicles a player can spawn. The
`vehiclePool` array is unbounded. Server RAM is the only limit. Competitive
mode blocks the wizard entirely (line 217), but freeroam has no cap. Admin
spawn also has no limit.

---

## 2. HIGH FINDINGS

### H-1 · Component Validation Bypassed for Weapons Without Attachment Data
**Files:** `WeaponPresets.service.ts` lines 267–271, 69–71

When saving or applying presets, component hashes are filtered against
`attachmentData.components`. If a weapon has no entry in
`MANUAL_WEAPON_ATTACHMENTS` and no backfill entry, `attachmentData` is
undefined and the fallback accepts any component hash the client sent
(deduplicated but unvalidated). These are persisted to the
`weapon_presets.components` JSONB column.

---

### H-2 · Preset Save in Competitive/Match Context Not Blocked
**Files:** `WeaponPresets.service.ts` — `savePreset` handler

`equipToFreeroam` blocks calls during competitive play (line 140). `savePreset`
does not have this guard. A player in a match can save weapon components
derived from match-granted weapons into their freeroam preset, potentially
smuggling components that would otherwise be restricted.

---

### H-3 · Clothing: Server Accepts Unbounded Drawable/Texture Values
**Files:** `Wardrobe.event.ts` — `isValidClothesSlot` (lines 110–121)

Server-side validation checks only:
- `typeof drawable === "number"` and `Number.isInteger(drawable)`
- `drawable >= 0` and `texture >= 0`

There is NO upper-bound check. A client can send `drawable: 2147483647,
texture: 2147483647` for any clothing slot and it will be stored in the DB.
The game engine silently rejects the value on load, but the garbage persists
indefinitely in the `character.appearance` JSONB column.

---

### H-4 · Clothing: Blocked Drawables List Not Enforced Server-Side
**Files:** `Wardrobe.event.ts`, `shared/json/wardrobeBlockedDrawables.json`

`wardrobeBlockedDrawables.json` contains blocked drawable ranges for "tops".
This is only applied in `Creator.class.ts` on the client when building the
UI picker. The `saveInline` handler on the server does not consult this list.
A player with a modified client can equip any blocked drawable directly.

---

### H-5 · Clothing: Gender/Model Mismatch Not Validated
**Files:** `Wardrobe.event.ts` — `saveClothesAndSync`

The server never checks that clothing components are appropriate for the
character's gender or ped model. Female-only drawables can be applied to a
male character and vice versa. Game engine will clamp or apply undefined
visuals silently.

---

### H-6 · No DB Transactions on Vehicle Writes
**Files:** `Vehicle.class.ts` — `saveVehicle()` (lines 512–549), `insertVehicle()` (lines 467–489)

Vehicle persistence writes 15+ columns in a single `update()` call. There is
no `queryRunner.startTransaction()` / `commitTransaction()` wrapping. If the
PostgreSQL connection drops mid-update, the row is left in a partially updated
state with no rollback. `Database.module.ts` does not configure a transaction
manager.

---

## 3. MEDIUM FINDINGS

### M-1 · Vehicle Mod Values Unbounded
**Files:** `Vehicle.class.ts` — `setTuningMod()` (lines 410–425)

`modIndex` is validated to 0–99 (correct). `modValue` is accepted as any
integer after `Math.floor()`. No model-specific validation — e.g., suspension
mods applied to a vehicle that doesn't support them. Mod values from the DB
are applied on load without re-validation.

[UNVERIFIED AGAINST LIVE DOCS] — Valid per-mod value ranges not confirmed.

---

### M-2 · Vehicle Color Values Unbounded
**Files:** `Vehicle.entity.ts`, `Vehicle.class.ts`

`primaryColor`, `secondaryColor`, `neonColor` stored as JSON arrays. LSC
colours are 0–159 (standard palette). RGB custom colours are 0–255 per
channel. Neither the entity nor `setTuningMod()` path validates these ranges.
Invalid colour indices persist in the DB and are applied on load.

---

### M-3 · No UNIQUE Constraint on Vehicle Plate
**Files:** `Vehicle.entity.ts`

The `plate` column (varchar 8) has no database-level UNIQUE constraint.
Multiple vehicles can share identical plate strings. Plate lookup logic
(e.g., police queries) would return ambiguous results.

---

### M-4 · owner_id Has No Foreign Key to Accounts
**Files:** `Vehicle.entity.ts` line 9

`owner_id` is an untyped `int` column with no FK relation to the accounts
table. Deleting an account does NOT cascade-delete vehicles. Orphaned vehicle
rows accumulate in the DB with no owner, and `owner_name` (denormalized
varchar) drifts out of sync after account renames.

---

### M-5 · Clothing: No Rate Limiting on saveInline
**Files:** `Wardrobe.event.ts` — CEF `saveInline` handler

No call-rate check on clothing saves. A modified client can call `saveInline`
in a tight loop, generating DB writes proportional to loop speed. No throttle
or cooldown enforced.

---

### M-6 · Component Desync on Client-Side Apply Failure
**Files:** `WeaponComponentTintSync.module.ts` (client, line 72)

Native `giveComponentToPed()` calls are wrapped in try-catch. If a native
call throws, the component is not applied on the local client, but the server
continues to believe it was applied (server-side `__weaponComponents` is not
rolled back). No retry or re-sync triggered.

---

### M-7 · Vehicle Class Field Unconstrained
**Files:** `Vehicle.entity.ts` — `class` column

`class` column defaults to -1 and stores the vehicle class (0–24 in GTA V).
No CHECK constraint. Stores any integer. UI that gates content by class would
behave unpredictably for out-of-range values.

---

## 4. PERSISTENCE / INTEGRITY FINDINGS

### P-1 · No Migration History
**Files:** `Database.module.ts` line 58 (`migrations: []`)

TypeORM is configured with `migrations: []` and `synchronize: true` (in beta).
There are no tracked migrations. Any destructive schema change auto-applied
in beta has no rollback path. Production relies on synchronize being `false`
but there is no migration safety net if it is accidentally toggled.

---

### P-2 · Weapon Preset Components Not Re-Validated on Load
**Files:** `WeaponPresets.service.ts` — `applyWeaponPresets` (lines 57–93)

On player spawn, presets are loaded from DB and applied. Component hashes
stored from before attachment-data was defined for a weapon are applied
without re-filtering. Corrupted or attacker-stored component hashes from
historical saves are applied directly.

---

### P-3 · Orphaned Vehicle Records on Server Crash Mid-Save
**Files:** `Vehicle.class.ts` — `destroyVehicle()` vs `saveVehicle()`

If `saveVehicle()` async is in-flight when the server crashes, the in-memory
vehicle is gone but the old DB state (with pre-save mods) is what persists
on next boot. No journaling, no idempotency token.

---

### P-4 · Clothing JSONB Column Has No Schema Constraint
**Files:** `Character.entity.ts` — `appearance` column (line 16)

The `appearance` JSONB column stores the entire character appearance
including clothing. It is cast as `(any)` by TypeORM, so no runtime type
checking at the ORM layer. Corrupted or incomplete clothing objects merge
with defaults via `?? operator` fallback on load, masking partial corruption
rather than surfacing it.

---

### P-5 · Vehicle JSON Columns (modifications, wheelmods, colors) Not Schema-Validated
**Files:** `Vehicle.entity.ts`

`modifications`, `wheelmods`, `primaryColor`, `secondaryColor`, `neonColor`
are all raw JSONB with no DB CHECK constraints and no TypeORM transformer.
Malformed JSON accepted at insert time will persist and cause runtime errors
on load.

---

## 5. RAGE:MP API / DOC VERIFICATION NOTES

Live RAGE:MP documentation was NOT accessible during this audit.
The following findings are marked as unverified:

| Finding | Claim | Status |
|---------|-------|--------|
| C-2 | Tint index range is 0–7 for most weapons | UNVERIFIED AGAINST LIVE DOCS |
| M-1 | Valid per-mod-index value ranges for setMod() | UNVERIFIED AGAINST LIVE DOCS |
| M-2 | LSC colour palette range is 0–159 | UNVERIFIED AGAINST LIVE DOCS |
| C-3 | RPG / minigun fall into carry group "primary" | UNVERIFIED AGAINST LIVE DOCS |

All other findings are based solely on TypeScript source analysis and do not
depend on RAGE:MP API guarantees.

---

## 6. RUNTIME TEST CHECKLIST (Weapons / Loadout / Clothing / Vehicles Only)

### Weapons & Loadout
- [ ] Send `equipToFreeroam` with `weapon_rpg` from a legitimate character — confirm if RPG is granted (tests C-1)
- [ ] Send `equipToFreeroam` with a weapon that has `enabled: false` in WEAPON_REGISTRY — confirm granted or blocked
- [ ] Send `setWeaponTint` with tint index 255 — confirm stored and synced to other clients (tests C-2)
- [ ] Send `savePreset` with an arbitrary component hash for a weapon not in MANUAL_WEAPON_ATTACHMENTS — confirm stored or rejected (tests H-1)
- [ ] Call `savePreset` while inside a match — confirm if preset is saved with match-granted weapons (tests H-2)
- [ ] Trigger a weapon change rapidly and confirm preset is re-applied within 650ms window (tests M-6)
- [ ] Force a client-side native failure on `giveComponentToPed` and verify if server and client are desynced (tests M-6)
- [ ] Restart server mid-apply and verify DB state matches what was intended

### Clothing
- [ ] Call `saveInline` with `drawable: 2147483647` for the hats slot — confirm value stored in DB (tests H-3)
- [ ] Call `saveInline` with a drawable in `wardrobeBlockedDrawables.json` — confirm if accepted (tests H-4)
- [ ] Apply female clothing to a male character via direct `saveInline` call — confirm stored (tests H-5)
- [ ] Spam `saveInline` 100 times/second — confirm no throttle (tests M-5)
- [ ] Stream in a player and confirm clothing applied from `getVariable("clothes")` matches DB (ClothesSync path)

### Vehicles
- [ ] Spawn 50 freeroam vehicles on one character — confirm no server limit (tests C-3)
- [ ] Send `setTuningMod` with `modValue: 9999` — confirm stored in DB and re-applied on load (tests M-1)
- [ ] Set `primaryColor` to `[999, 999, 999]` — confirm stored and what happens on apply (tests M-2)
- [ ] Create two vehicles with identical plates — confirm possible given no UNIQUE constraint (tests M-3)
- [ ] Delete an account with vehicles — confirm vehicles remain orphaned in DB (tests M-4)
- [ ] Kill server during `saveVehicle()` async operation — confirm DB state (tests P-3)
- [ ] Boot server with a vehicle row that has malformed `modifications` JSON — confirm crash or silent skip
