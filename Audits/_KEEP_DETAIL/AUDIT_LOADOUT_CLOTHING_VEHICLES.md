# AUDIT_LOADOUT_CLOTHING_VEHICLES.md

Arena Server — Weapons / Loadout / Clothing / Vehicles  
Audit Date: 2026-04-24  
Auditor: Claude Code (read-only, no fixes applied)  
RAGE:MP doc access: UNAVAILABLE — findings marked [UNVERIFIED AGAINST LIVE DOCS] where relevant

---

## Files Analyzed

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
- `gamemode/source/client/classes/Vehicle.class.ts`
- `gamemode/source/shared/loadout/weaponRegistry.ts`
- `gamemode/source/shared/clothingEditorRegions.ts`
- `gamemode/source/shared/wardrobeStage.ts`
- `gamemode/source/shared/json/wardrobeBlockedDrawables.json`
- `gamemode/source/shared/vehicleTune/vehicleTuneCatalog.ts`
- `gamemode/frontend/src/stores/Wardrobe.store.ts`
- `gamemode/frontend/src/pages/clothing/ClothingPanel.tsx`
- `gamemode/frontend/src/assets/clothesLimits.ts`

---

## 1. CRITICAL FINDINGS

### C-1 · No Server-Side Weapon Whitelist Enforcement

**Files:** `WeaponPresets.service.ts` — `equipToFreeroam`, `equipForEdit`, `savePreset` handlers

The server resolves weapon names to JOAAT hashes and grants them without ever
checking the `WEAPON_REGISTRY.enabled` flag defined in
`shared/loadout/weaponRegistry.ts`.

Attack path:
- Client sends `weaponName: "weapon_rpg"` (or any GTA V weapon string) to `equipToFreeroam`.
- Server calls `resolveWeaponHashFromName()` → valid JOAAT hash.
- Server checks only: hash ≠ unarmed hash, carry-group returned is `"primary"` or `"sidearm"`.
- Server grants the weapon unconditionally.

Weapons that fail the carry-group check (e.g., melee, thrown) are blocked by that
indirect guard. Weapons like RPG, grenade launcher, or minigun that return a valid carry
group are NOT blocked. `WEAPON_REGISTRY` is never consulted in any of these three handlers.

Identical gap in `savePreset` — weapon name is stored without whitelist check.

---

### C-2 · No Validation of Tint Indices (Server or Client)

**Files:** `WeaponComponentTintSync.prototype.ts` — `setWeaponTint`

`setWeaponTint(hash, tintIndex)` stores whatever integer the client sends with no range
check. GTA V valid range is 0–7 for most weapons (0–255 for some). The value propagates
to the `currentWeaponTint` player variable, is broadcast to all in-range players, and is
applied client-side without clamping.

[UNVERIFIED AGAINST LIVE DOCS] — Exact per-weapon tint limits not confirmed from live
RAGE:MP docs.

---

### C-3 · No Per-Player Vehicle Spawn Limit

**Files:** `Vehicle.event.ts` — `spawnVehicleFromWizard`, `Vehicle.class.ts` constructor

Nothing limits how many freeroam vehicles a single player can spawn. The `vehiclePool`
array is unbounded. Server RAM is the only practical limit. Competitive mode blocks the
wizard (line 217 of Vehicle.event.ts), but freeroam has no cap. Admin spawn also has
no limit.

---

## 2. HIGH FINDINGS

### H-1 · Component Validation Bypassed for Weapons Without Attachment Data

**Files:** `WeaponPresets.service.ts` lines 267–271, 69–71

When saving or applying presets, component hashes are filtered against
`attachmentData.components`. If a weapon has no entry in `MANUAL_WEAPON_ATTACHMENTS` and
no backfill entry in `missingRegistryBackfill`, `attachmentData` is `undefined` and the
fallback code path (line 271) accepts any component hash the client sent — deduplicated
but not validated against any known-good list. These hashes are persisted directly to the
`weapon_presets.components` JSONB column.

---

### H-2 · Preset Save in Competitive / Match Context Not Blocked

**Files:** `WeaponPresets.service.ts` — `savePreset` handler

`equipToFreeroam` blocks calls during competitive play (line 140). `savePreset` has no
equivalent guard. A player inside a match can save weapon component combinations derived
from match-granted weapons into their freeroam preset, potentially smuggling components
that would otherwise be unavailable outside the match.

---

### H-3 · Clothing: Server Accepts Unbounded Drawable / Texture Values

**Files:** `Wardrobe.event.ts` — `isValidClothesSlot` (lines 110–121)

Server-side validation checks only:
- `typeof drawable === "number"` and `Number.isInteger(drawable)`
- `drawable >= 0` and `texture >= 0`

There is NO upper-bound check. A client can send `drawable: 2147483647, texture: 2147483647`
for any clothing slot and it will be accepted and stored in the DB. The game engine silently
rejects invalid values on load, but the garbage data persists indefinitely in the
`character.appearance` JSONB column.

---

### H-4 · Clothing: Blocked Drawables List Not Enforced Server-Side

**Files:** `Wardrobe.event.ts`, `shared/json/wardrobeBlockedDrawables.json`

`wardrobeBlockedDrawables.json` defines blocked drawable ranges for the "tops" component.
This list is consumed only in `Creator.class.ts` on the client to filter the UI picker.
The `saveInline` server handler does not consult this list. A player with a modified client
can equip any blocked drawable by sending a direct `saveInline` event.

---

### H-5 · Clothing: Gender / Model Mismatch Not Validated

**Files:** `Wardrobe.event.ts` — `saveClothesAndSync`

The server never validates that the submitted clothing component drawables are appropriate
for the character's gender or ped model. Female-only drawables can be applied to a male
character and vice versa. The game engine applies an undefined or nearest visual silently.

---

### H-6 · No DB Transactions on Vehicle Writes

**Files:** `Vehicle.class.ts` — `saveVehicle()` (lines 512–549), `insertVehicle()` (lines 467–489)

Both functions execute a single `update()` or `save()` call covering 15+ columns with no
`queryRunner.startTransaction()` / `commitTransaction()` wrapping. If the PostgreSQL
connection drops mid-update, the row is left in a partially updated state with no rollback
path. `Database.module.ts` does not configure a TypeORM transaction manager.

---

## 3. MEDIUM FINDINGS

### M-1 · Vehicle Mod Values Unbounded

**Files:** `Vehicle.class.ts` — `setTuningMod()` (lines 410–425)

`modIndex` is validated to 0–99 (correct). `modValue` is accepted as any integer after
`Math.floor()` with no upper-bound or model-specific check. For example, suspension mods
can be applied to models that do not support them. Mod values loaded from the DB are
applied on startup without re-validation.

[UNVERIFIED AGAINST LIVE DOCS] — Valid per-mod-index value ranges not confirmed from live
RAGE:MP docs.

---

### M-2 · Vehicle Color Values Unbounded

**Files:** `Vehicle.entity.ts`, `Vehicle.class.ts`

`primaryColor`, `secondaryColor`, and `neonColor` are stored as JSON arrays. The standard
LSC colour palette is 0–159; RGB custom colours are 0–255 per channel. Neither the entity
schema nor the mod-application path validates these ranges. Invalid values persist in the
DB and are applied on vehicle load.

---

### M-3 · No UNIQUE Constraint on Vehicle Plate

**Files:** `Vehicle.entity.ts`

The `plate` column (varchar 8) has no database-level UNIQUE constraint. Multiple vehicles
can share identical plate strings. Any server feature that looks up a vehicle by plate
number (e.g., police systems) will return ambiguous or incorrect results.

---

### M-4 · `owner_id` Has No Foreign Key to Accounts

**Files:** `Vehicle.entity.ts` line 9

`owner_id` is an untyped `int` column with no FK relation to the accounts table. Deleting
an account does NOT cascade-delete that player's vehicles. Orphaned vehicle rows accumulate
with a stale `owner_id`, and the denormalized `owner_name` varchar column drifts out of
sync after account renames.

---

### M-5 · Clothing: No Rate Limiting on `saveInline`

**Files:** `Wardrobe.event.ts` — CEF `saveInline` handler

No call-rate throttle or cooldown is enforced on clothing saves. A modified client can
emit `saveInline` in a tight loop and generate DB writes at the loop rate. No debounce,
no per-player cooldown.

---

### M-6 · Component Desync on Client-Side Apply Failure

**Files:** `WeaponComponentTintSync.module.ts` (client, line 72)

Native `giveComponentToPed()` calls are wrapped in try-catch. If a native call throws,
the component is silently skipped on the local client, but the server's `__weaponComponents`
map is not rolled back. Server and client state diverge with no retry or forced re-sync
triggered.

---

### M-7 · Vehicle Class Field Unconstrained

**Files:** `Vehicle.entity.ts` — `class` column

The `class` column defaults to `-1` and stores the GTA V vehicle class (0–24). No DB CHECK
constraint exists. Any out-of-range integer is stored. Server UI or logic that gates content
by vehicle class will behave unpredictably for invalid stored values.

---

## 4. PERSISTENCE / INTEGRITY FINDINGS

### P-1 · No Migration History

**Files:** `Database.module.ts` line 58 (`migrations: []`)

TypeORM is configured with `migrations: []` and `synchronize: true` (when `DB_BETA === "true"`).
No migrations are tracked. Any destructive schema change auto-applied in beta has no rollback
path. Production relies on `synchronize: false`, but there is no migration safety net if that
flag is accidentally toggled.

---

### P-2 · Weapon Preset Components Not Re-Validated on Load

**Files:** `WeaponPresets.service.ts` — `applyWeaponPresets` (lines 57–93)

On player spawn, presets are loaded from the DB and applied. Component hashes that were stored
before attachment-data was defined for a weapon (or stored via the H-1 bypass path) are applied
without re-filtering. Historically persisted or attacker-stored component hashes go directly to
the native grant call.

---

### P-3 · Orphaned Vehicle Records on Server Crash Mid-Save

**Files:** `Vehicle.class.ts` — `destroyVehicle()` vs `saveVehicle()`

If `saveVehicle()` is in-flight when the server crashes, the in-memory vehicle is gone but
the pre-crash DB state persists. On next boot, the vehicle loads with stale mod data. No
journaling or idempotency token exists to detect or recover from this split.

---

### P-4 · Clothing JSONB Column Has No Schema Constraint

**Files:** `Character.entity.ts` — `appearance` column (line 16)

The `appearance` JSONB column stores the entire character appearance including all clothing
slots. TypeORM casts it as `(any)`, eliminating ORM-layer type checking. Corrupted or
incomplete clothing objects merge silently with defaults via `??` fallback on load, masking
partial corruption rather than surfacing it as an error.

---

### P-5 · Vehicle JSON Columns Not Schema-Validated

**Files:** `Vehicle.entity.ts`

`modifications`, `wheelmods`, `primaryColor`, `secondaryColor`, and `neonColor` are raw JSONB
columns with no DB CHECK constraints and no TypeORM value transformer. Malformed or
out-of-range values written at insert time persist in the DB and are applied verbatim on
vehicle load, with no safeguard against runtime errors.

---

## 5. RAGE:MP API / DOC VERIFICATION NOTES

Live RAGE:MP documentation was NOT accessible during this audit. The following findings
contain claims that depend on RAGE:MP or GTA V API behaviour and could not be verified
against live documentation:

| Finding | Claim | Status |
|---------|-------|--------|
| C-2 | Valid tint index range is 0–7 for most weapons | UNVERIFIED AGAINST LIVE DOCS |
| M-1 | Valid per-mod-index value ranges for `setMod()` | UNVERIFIED AGAINST LIVE DOCS |
| M-2 | LSC standard colour palette range is 0–159 | UNVERIFIED AGAINST LIVE DOCS |
| C-3 | RPG / minigun return carry group `"primary"` | UNVERIFIED AGAINST LIVE DOCS |

All other findings are based solely on TypeScript source analysis and do not depend on
RAGE:MP API guarantees.

---

## 6. RUNTIME TEST CHECKLIST

### Weapons & Loadout

- [ ] Send `equipToFreeroam` with `weapon_rpg` from a legitimate character — confirm whether RPG is granted (tests C-1)
- [ ] Send `equipToFreeroam` with a weapon that has `enabled: false` in `WEAPON_REGISTRY` — confirm granted or rejected
- [ ] Send `setWeaponTint` with tint index `255` — confirm value stored and synced to nearby clients (tests C-2)
- [ ] Send `savePreset` with an arbitrary component hash for a weapon absent from `MANUAL_WEAPON_ATTACHMENTS` — confirm stored or rejected (tests H-1)
- [ ] Call `savePreset` while inside an active match — confirm whether preset is saved with match-granted weapon components (tests H-2)
- [ ] Rapidly switch weapons and confirm preset is re-applied within the 650 ms cooldown window
- [ ] Force a client-side `giveComponentToPed` native failure and confirm server/client state diverge (tests M-6)
- [ ] Restart the server mid-apply and confirm DB state matches the intended preset

### Clothing

- [ ] Call `saveInline` with `drawable: 2147483647` for the hats slot — confirm value is stored in DB (tests H-3)
- [ ] Call `saveInline` with a drawable index that appears in `wardrobeBlockedDrawables.json` — confirm accepted (tests H-4)
- [ ] Submit female-model clothing for a male character via direct `saveInline` — confirm stored (tests H-5)
- [ ] Emit `saveInline` at high frequency — confirm no throttle or cooldown (tests M-5)
- [ ] Stream in a player and confirm clothing synced via `getVariable("clothes")` matches the DB row

### Vehicles

- [ ] Spawn 50 freeroam vehicles on one character — confirm no server-side limit is enforced (tests C-3)
- [ ] Send `setTuningMod` with `modValue: 9999` — confirm stored in DB and re-applied on next server boot (tests M-1)
- [ ] Set `primaryColor` to `[999, 999, 999]` — confirm stored and observe what `setVehicleColours` does with it (tests M-2)
- [ ] Create two vehicles with identical plate strings — confirm the DB allows duplicates (tests M-3)
- [ ] Delete an account that owns vehicles — confirm vehicle rows remain orphaned in the DB (tests M-4)
- [ ] Kill the server process during a `saveVehicle()` async operation — confirm resulting DB state (tests P-3)
- [ ] Boot the server with a vehicle row containing malformed `modifications` JSON — confirm crash or silent skip behaviour
