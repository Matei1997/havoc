# Rage Arena - Verified Issue List

**Date:** 2026-03-12
**Method:** Line-by-line source code verification against audit findings
**Status Legend:** VERIFIED | PARTIALLY TRUE | NEEDS MANUAL REVIEW | NOT CONFIRMED

---

## ISSUE 1: Triplicated Damage Logic

**Status: VERIFIED**

### Evidence

**File:** `gamemode-2/gamemode/source/server/serverevents/DamageSync.event.ts`

Three near-identical code blocks exist at:
- **FFA block:** Lines 161-186 (26 lines)
- **Gun Game block:** Lines 187-212 (26 lines)
- **Hopouts block:** Lines 213-239 (27 lines)

**Exact duplication confirmed line-by-line:**

| Step | FFA (L161-186) | Gun Game (L187-212) | Hopouts (L213-239) |
|------|---------------|---------------------|---------------------|
| Weapon lookup | `weaponDamage[weaponHash] ?? {base: DEFAULT_WEAPON_BASE, min: DEFAULT_WEAPON_MIN}` | Identical | Identical |
| Cap calc | `Math.min(25, 8 + w.base * 0.5)` | `Math.min(25, 8 + w.base * 0.5)` | `Math.min(ARENA_CAP_MAX, ARENA_CAP_BASE + w.base * 0.5)` |
| Damage scale | `finalDamage * 0.75` | `finalDamage * 0.75` | `finalDamage * ARENA_DAMAGE_MULT` |
| Effective HP | Same formula | Same formula | Same formula |
| Armor-first | Same logic | Same logic | Same logic |
| Health reduction | Same logic | Same logic | Same logic |
| Kill check | `effectiveHp <= 0` | `effectiveHp <= 0` | `effectiveHp <= 0` |
| Death handler | `handleFfaDeath(victim, shooter)` | `handleGunGameDeath(victim, shooter)` | `handleArenaDeath(victim, shooter)` |
| Damage tracking | `recordDamageToVictim(...)` | Identical | Identical |
| Set vitals | `victim.call("client::player:setVitals"...)` | Identical | Identical |
| Damage direction | `RAGERP.cef.emit(victim, "arena", "damageDirection"...)` | Identical | Identical |

### Differences found (2 total)

1. **FFA/GunGame use hardcoded `25` and `8`; Hopouts uses constants `ARENA_CAP_MAX` (25) and `ARENA_CAP_BASE` (8).** The values are IDENTICAL at runtime. FFA and Gun Game just inline the magic numbers instead of referencing the constants. This means a constant change in Hopouts would NOT propagate to FFA/GunGame.

2. **FFA/GunGame use hardcoded `0.75`; Hopouts uses `ARENA_DAMAGE_MULT` (0.75).** Same problem.

### Practical risk

If you change the damage formula, cap, or multiplier for balance tuning, you must update 3 blocks. Missing one creates different TTK across modes with no compile-time warning. This is the most likely source of future balance bugs.

### Smallest safe fix

Extract a function:
```typescript
function applyModeDamage(
    victim: PlayerMp, shooter: PlayerMp, finalDamage: number, weaponHash: string,
    isHead: boolean, timeSinceLastShot: number,
    onDeath: (victim: PlayerMp, shooter: PlayerMp) => void
): number { /* shared logic */ }
```
Call it from each branch, passing only the mode-specific death handler. ~30 lines of new code, ~75 lines deleted.

**Difficulty:** Easy (1-2 hours). **Risk:** Very low — pure extraction, no behavior change.

---

## ISSUE 2: Per-Frame Vitals Push to CEF

**Status: PARTIALLY TRUE**

### Evidence

**Two separate vitals push systems exist:**

#### A. Freeroam HUD — Per-frame, NO change detection (CONFIRMED ISSUE)

**File:** `gamemode-2/gamemode/source/client/classes/Hud.class.ts`
- **Line 20:** `mp.events.add("render", this.pushVitalsToCefEveryFrame.bind(this));`
- **Lines 24-28:**
  ```typescript
  private pushVitalsToCefEveryFrame(): void {
      if (!Browser.currentPage || Browser.currentPage !== "hud") return;
      this.setPlayerData("health", this.lastVitals.health);
      this.setPlayerData("armour", this.lastVitals.armour);
  }
  ```
- Each `setPlayerData` call goes through `Browser.processEvent("cef::player:setPlayerData", key, value)` which calls `mainUI.call()` → JSON.stringify → CEF → EventManager.callHandler → MobX observable update → React re-render.
- **This runs every frame (~60/s) even when values haven't changed.**

#### B. Arena HUD — Per-frame WITH change detection (NOT AN ISSUE)

**File:** `gamemode-2/gamemode/source/client/modules/ArenaVitals.module.ts`
- **Lines 3-4:** `let lastHealth = -1; let lastArmor = -1;`
- **Line 17:** `if (health === lastHealth && armor === lastArmor) return;`
- This correctly skips the CEF push when values are unchanged.

### Correction to audit

The audit stated this was a universal problem. In reality:
- **Freeroam HUD (`"hud"` page):** CONFIRMED — pushes every frame unconditionally.
- **Arena HUD (`"arena_hud"` page):** NOT an issue — has proper change detection.

### Practical risk

On the freeroam HUD, health/armor are pushed to CEF ~60 times/second even when standing still. Each push: `JSON.stringify` → CEF bridge → `EventManager.callHandler` → MobX `setData` → triggers `observer()` React components. This is wasted CPU on both client and CEF renderer. On lower-end PCs, this contributes to micro-stutter.

During arena matches (where performance matters most), this is NOT happening because ArenaVitals has the guard.

### Smallest safe fix

Add change detection to `Hud.class.ts`:
```typescript
private pushVitalsToCefEveryFrame(): void {
    if (!Browser.currentPage || Browser.currentPage !== "hud") return;
    if (this._lastPushedHealth === this.lastVitals.health
        && this._lastPushedArmour === this.lastVitals.armour) return;
    this._lastPushedHealth = this.lastVitals.health;
    this._lastPushedArmour = this.lastVitals.armour;
    this.setPlayerData("health", this.lastVitals.health);
    this.setPlayerData("armour", this.lastVitals.armour);
}
```

**Difficulty:** Trivial (15 minutes). **Risk:** None.

---

## ISSUE 3: Arena.store Timeout / Event Handler Accumulation

**Status: PARTIALLY TRUE — Timeout accumulation is real; handler leak is not**

### Evidence

**File:** `gamemode-2/gamemode/frontend/src/stores/Arena.store.ts`

#### A. Timeout accumulation — CONFIRMED

The `_arenaDeathTimeouts` array (Line 166) has timeouts pushed from these handlers:
- `arena:roundResult` (Line 248) — 3000ms
- `arena:damageDirection` (Line 301) — 850ms
- `arena:lastAlive` (Line 295) — 3000ms
- `arena:damageNumber` (Line 329) — 700ms per damage number
- `arena:youDied` (Lines 347-354) — two timeouts: 1500ms + 3500ms

**Cleanup points:**
- `clearArenaDeathOverlay()` (Line 421) — clears array and cancels all timeouts
- Called by: `arena:roundStart` (Line 220), `arena:matchEnd` (Line 393), `arena:leftMatch` (Line 416)

**The issue:** During a rapid combat sequence, `_arenaDeathTimeouts` can accumulate many entries. Each damage number adds a timeout. In a 10-player FFA with rapid fire, dozens of damage numbers per second means dozens of active timeouts. The array grows until the next `clearArenaDeathOverlay()` call.

**However:** The timeouts self-resolve after 700-3500ms. The array only accumulates pending timeout IDs. Once a timeout fires and its callback executes, the ID remains in the array as a stale number (no leak, just a stale reference). The real concern is not memory but unnecessary array growth and the `forEach(clearTimeout)` call iterating over already-fired IDs.

#### B. Event handler leak — NOT CONFIRMED

The audit claimed handlers could duplicate if the store is reinstantiated. But:
- `Arena.store.ts` exports a singleton: `export const arenaStore = new ArenaStore();` (Line 437)
- The constructor runs once at module load time
- MobX `configure({ enforceActions: "always" })` is set in `index.tsx`
- There is no code path that creates a second `ArenaStore` instance

The handlers will NOT duplicate under normal operation.

### Practical risk

Low-to-medium. The timeout array grows during intense combat but self-heals on round transitions. Not a memory leak, but an accumulating array of stale numbers that gets batch-cleared. In extreme cases (very long FFA with constant kills), the array could reach hundreds of entries before cleanup.

### Smallest safe fix

Replace the array-based approach with individual timeout tracking per feature:
```typescript
private _damageDirectionTimeout: ReturnType<typeof setTimeout> | null = null;
private _lastAliveTimeout: ReturnType<typeof setTimeout> | null = null;
// etc.
```
Or, for damage numbers specifically, let the filter-on-removal approach handle cleanup instead of storing timeout IDs.

**Difficulty:** Easy (1 hour). **Risk:** Very low.

---

## ISSUE 4: Duplicated Seasonal vs Lifetime Stat Calculations

**Status: VERIFIED**

### Evidence

#### MMR Calculation — Duplicated in 2 files

**File A:** `gamemode-2/gamemode/source/server/modules/stats/StatsManager.ts`
- Lines 8-12: Constants `PLACEMENT_MATCHES=5, MMR_WIN=25, MMR_LOSS=-20, MMR_MODIFIER_MIN=-5, MMR_MODIFIER_MAX=5`
- Lines 47-76: `updateRankedMatchResult()` — MMR delta formula

**File B:** `gamemode-2/gamemode/source/server/modules/seasons/SeasonManager.ts`
- Lines 14-18: **Same constants redeclared:** `PLACEMENT_MATCHES=5, MMR_WIN=25, MMR_LOSS=-20, MMR_MODIFIER_MIN=-5, MMR_MODIFIER_MAX=5`
- Lines 80-113: `updateSeasonalRankedMatchResult()` — **Same MMR delta formula**

The formulas are character-for-character identical:
```typescript
const kdDiff = input.kills - input.deaths;
const modifier = Math.max(MMR_MODIFIER_MIN, Math.min(MMR_MODIFIER_MAX, kdDiff));
let delta: number;
if (input.isWin) delta = MMR_WIN + modifier;
else if (input.isLoss) delta = MMR_LOSS + modifier;
else delta = 0;
const newMMR = Math.max(0, oldMMR + delta);
```

**Note:** `SeasonManager.ts` does correctly import `getRankTierFromMmr` from `StatsManager` (Line 12). So the tier thresholds are NOT duplicated — only the MMR delta formula and its constants.

#### XP / Level Calculation — Duplicated in 2 files

**File A:** `gamemode-2/gamemode/source/server/modules/stats/ProgressionManager.ts`
- Line 18: `getRequiredXpForLevel(level)` → `500 + (level - 1) * 150`
- Lines 57-86: `addXp()` — level-up loop with `MAX_LEVEL` cap (50)
- Lines 9-10: `XP_WIN=150, XP_LOSS=80`

**File B:** `gamemode-2/gamemode/source/server/modules/seasons/SeasonManager.ts`
- Line 132: Inline `getRequired = (lvl: number) => 500 + (lvl - 1) * 150` — **same formula**
- Lines 118-150: `addSeasonalXp()` — **same level-up loop**
- Lines 115-116: `XP_WIN=150, XP_LOSS=80` — **same constants redeclared**

**Critical difference found:** The level cap is DIFFERENT.
- `ProgressionManager.ts` uses `MAX_LEVEL` (imported from `PrestigeManager`, value = 50)
- `SeasonManager.ts` uses hardcoded `999`

This means seasonal levels can go to 999 while lifetime levels cap at 50. This may be intentional (seasonal levels uncapped) or an oversight.

### Practical risk

**High.** If you change MMR formula (e.g., different win/loss values, different modifier range), you must update both files. The constants are local to each file with no compile-time link. The XP formula is also duplicated — changing one doesn't affect the other.

The level cap difference (50 vs 999) needs design clarification.

### Smallest safe fix

1. Move MMR constants and the delta calculation to a shared function in `StatsManager.ts`:
   ```typescript
   export function calculateMmrDelta(kills: number, deaths: number, isWin: boolean, isLoss: boolean): number
   ```
2. Move XP level-up logic to a shared function in `ProgressionManager.ts`:
   ```typescript
   export function calculateLevelUp(currentXp: number, currentLevel: number, addedXp: number, maxLevel: number)
   ```
3. `SeasonManager.ts` calls both, passing its own `maxLevel` parameter.

**Difficulty:** Easy (1-2 hours). **Risk:** Very low — pure extraction.

---

## ISSUE 5: Stringly-Typed Event Names

**Status: VERIFIED**

### Evidence

**Across the entire codebase, event names are raw string literals with zero shared constants.**

Counts:
- **CEF/React side:** 204 `EventManager.addHandler/emitServer/emitClient` calls across 59 files
- **Server side:** 174 `RAGERP.cef.register/emit` calls across 30 files
- **Client side:** 14 `Browser.processEvent` calls across 6 files
- **Total:** ~392 event call sites using raw strings

**Search for any shared event constants:** `EventNames`, `EVENT_NAMES`, `eventNames` — **0 results** in project source (only in node_modules).

**Example of fragility:**

Server emits:
```typescript
RAGERP.cef.emit(player, "arena", "matchUpdate", data);
// This becomes "cef::arena:matchUpdate" on the client
```

Store listens:
```typescript
EventManager.addHandler("arena", "matchUpdate", (data: ArenaMatchData) => { ... });
```

A typo in either string (e.g., `"matchupdate"` vs `"matchUpdate"`) fails silently — `EventManager.callHandler` logs to console.error but the UI simply doesn't update. No compile-time or runtime exception.

### Practical risk

**Medium.** The current codebase works because the strings are established and tested. But every new feature requires matching strings across 3 layers (server → client → CEF) by convention only. The risk increases linearly with team size and feature velocity.

### Smallest safe fix

Create `source/shared/events/EventChannels.ts`:
```typescript
export const ARENA_CHANNEL = "arena" as const;
export const ARENA_EVENTS = {
    MATCH_UPDATE: "matchUpdate",
    ROUND_START: "roundStart",
    // ...
} as const;
```
Adopt incrementally — new events use constants, existing events migrate when touched.

**Difficulty:** Easy to start (2 hours for the file + first usages). Full adoption is a longer gradual effort. **Risk:** None — additive only.

---

## ISSUE 6: Mixed Color Systems / UI Inconsistency

**Status: VERIFIED**

### Evidence

**File:** `gamemode-2/gamemode/frontend/src/styles/vars.scss`

Two complete color systems coexist:

| Token | Original | V0 |
|-------|----------|-----|
| Accent | `$accent: #591b87` (purple) | `$v0-accent: #00e0c6` (teal) |
| Background | `$global-color: #0a0a0e` (near-black) | `$v0-bg: #0a0f16` (dark navy) |
| Panel | `$glass-bg: rgba(14, 12, 22, 0.88)` (deep purple glass) | `$v0-panel: #111922` (dark blue) |
| HUD accent | `$hud-accent: $accent` (purple) | `$v0-accent: #00e0c6` (teal) |

**Usage verification across SCSS files:**

| File | Uses Original | Uses V0 |
|------|:---:|:---:|
| `mainmenu.module.scss` | No | `$v0-bg`, `$v0-panel`, `$v0-accent`, `$v0-border`, `$v0-accent-dim`, `$v0-admin-accent` throughout |
| `arenaHud.module.scss` | `$hud-*` vars | No |
| `arena.module.scss` | Likely `$hud-*` | Some V0 |
| `hud.module.scss` | `$hud-*` vars | No |
| `auth.module.scss` | Original | No |
| `creator.module.scss` | Original | No |
| `admin.module.scss` | Unknown | Likely V0 (admin accent) |

Additionally, `mainmenu.module.scss` contains **extensive hardcoded colors** not referenced from either system:
- `#878787` (muted text) — used 30+ times, not a variable
- `#EDEDED` (light text) — used 20+ times, not a variable
- `#FFB74D` (orange/reward) — used 5+ times
- `#FF5E5E` (red/error) — used 3+ times
- `#4CAF50` (green/success) — used 3+ times
- `#B0BEC5` (blue-grey) — used 4+ times

### Practical risk

**Low for stability, medium for development speed.** Players see teal menus and purple HUDs in the same session. Changing the accent color requires modifying both `$accent` and `$v0-accent` plus hunting hardcoded hex values. Not a bug risk, but slows any visual polish work.

### Smallest safe fix

1. Pick one palette (likely V0 teal, since the menu is the most-seen UI)
2. Replace `$hud-accent: $accent` → `$hud-accent: $v0-accent` in `vars.scss`
3. Run a find-replace of the top hardcoded colors into new variables: `$text-muted: #878787`, `$text-primary: #EDEDED`, `$color-reward: #FFB74D`

**Difficulty:** Medium (3-4 hours for full pass). **Risk:** Low — visual-only, easily reversible.

---

## ISSUE 7: Dead Code / RP Remnants

**Status: VERIFIED (multiple items with varying confidence)**

### 7a. Inventory namespace in shared/index.ts — VERIFIED DEAD

**File:** `gamemode-2/gamemode/source/shared/index.ts`
- Lines 495-827: `RageShared.Inventory` namespace — **332 lines**
- Contains: `ITEM_TYPES` enum (~130 items), `INVENTORY_CLOTHING`, `ITEM_TYPE_CATEGORY`, `IBaseItem`, `IInventoryItem`, clothing interfaces, weapon interfaces, etc.

**Usage search:** Only 2 references found, both **commented out** in `Dev.commands.ts` (lines 54, 57). Zero active code references to `RageShared.Inventory` anywhere.

**Verdict:** 332 lines of dead code. Safe to remove entirely.

### 7b. BankAccountEntity — VERIFIED DEAD (but has DB dependency)

**File:** `gamemode-2/gamemode/source/server/database/entity/Bank.entity.ts` (27 lines)

**Active references:**
- `Character.entity.ts:49-50` — `@OneToMany(() => BankAccountEntity, (bank) => bank.character)` relation
- `Database.module.ts:57` — registered as entity in TypeORM connection

**No code reads/writes bank data anywhere.** However, it's a TypeORM entity with a `bank_accounts` table. Removing it requires a database migration to drop the relation/table, or TypeORM will error.

**Verdict:** Dead code but requires DB migration. The Database README even notes: `Bank.entity.ts — RP legacy, mark for removal`.

### 7c. wantedLevel — VERIFIED DEAD (functionally)

**File:** `gamemode-2/gamemode/source/server/database/entity/Character.entity.ts`
- Line 41: `wantedLevel: number = 0;` — DB column
- Line 101: `player.character.setStoreData(player, "wantedLevel", player.character.wantedLevel);` — pushed to client on character load

**File:** `gamemode-2/gamemode/source/shared/index.ts`
- Line 368: `wantedLevel: number;` — in `IPlayerData` interface

**File:** `gamemode-2/gamemode/frontend/src/stores/Player.store.ts`
- Line 36: `wantedLevel: 5` — hardcoded default (note: 5, not 0)

**No code reads `wantedLevel` for any game logic.** It's set on the DB entity, pushed to the client store, but never consumed by any UI component or game system.

**Verdict:** Dead. However, it's a DB column — removal requires migration. The store default (5) is also suspicious.

### 7d. bankData in Player.store — VERIFIED DEAD

**File:** `gamemode-2/gamemode/frontend/src/stores/Player.store.ts`
- Lines 14-18:
  ```typescript
  bankData: { accountnumber: number; balance: number; pincode: number } | null = {
      accountnumber: 0,
      balance: 1,
      pincode: 1234
  };
  ```

**No event handler sets or reads `bankData`.** No component imports it. Pure RP remnant with a hardcoded pincode.

**Verdict:** Dead. Safe to remove from the store (no DB impact).

### 7e. Re-export shim files in /arena/ — VERIFIED (backward compat layer)

**Files (6 total):**
- `server/arena/Arena.module.ts` (17 lines) — re-exports from `modes/hopouts/Arena.module`
- `server/arena/ArenaConfig.ts` (14 lines) — re-exports from `modes/hopouts/ArenaConfig`
- `server/arena/ArenaPresets.asset.ts` (5 lines) — re-exports from `modes/hopouts/ArenaPresets.asset`
- `server/arena/ArenaMatch.manager.ts` (21 lines) — re-exports from `modes/hopouts/ArenaMatch.manager`
- `server/arena/ZoneSystem.ts` — needs verification (not read)

**Imports through shims (verified):**
- `serverevents/MainMenu.event.ts` imports `@arena/Arena.module` (the shim)
- `serverevents/DamageSync.event.ts` imports `@arena/ArenaMatch.manager` (the shim)
- `serverevents/Arena.event.ts` imports `@arena/Arena.module` and `@arena/ArenaConfig`

These work because of the `@arena/*` path alias in tsconfig. The shims are functional but add unnecessary indirection.

**Verdict:** Not dead (actively imported), but unnecessary indirection. Can be removed by updating import paths to `@modes/hopouts/*` directly.

### 7f. Empty shared directories — VERIFIED

All contain only `.gitkeep`:
- `shared/dto/`, `shared/config/`, `shared/constants/`, `shared/events/`, `shared/enums/`, `shared/schemas/`

**Verdict:** Unused scaffolding. Harmless but cluttery.

### 7g. Documentation files in source directories — VERIFIED

Found in frontend source:
- `mainmenu/PARTY_UI_AUDIT.md`
- `mainmenu/PARTY_INVITE_FLOW.md`
- `mainmenu/PARTY_UI_WIRING.md`

Found in server modules:
- `modules/party/PARTY_HARDENING_PASS.md`
- `modules/party/PARTY_QUEUE_INTEGRATION.md`
- `modules/matches/MATCH_SYSTEM_NOTES.md`
- `modes/hopouts/HOPOUTS_MIGRATION_NOTES.md`
- `modes/gungame/GUNGAME_MODE_SYSTEM.md`

**Verdict:** Not dead code — documentation. But scattered across source directories instead of a central docs location. Included in the frontend build output unnecessarily.

---

## SUMMARY TABLE

| # | Finding | Status | Fix Effort | Risk of Fix |
|---|---------|--------|------------|-------------|
| 1 | Triplicated damage logic | **VERIFIED** | 1-2 hours | Very low |
| 2 | Per-frame vitals push | **PARTIALLY TRUE** — only freeroam HUD, arena has guard | 15 min | None |
| 3a | Timeout accumulation | **VERIFIED** — low severity | 1 hour | Very low |
| 3b | Event handler leak | **NOT CONFIRMED** — singleton prevents it | N/A | N/A |
| 4a | MMR formula duplicated | **VERIFIED** — identical constants + logic | 1-2 hours | Very low |
| 4b | XP formula duplicated | **VERIFIED** — but level cap intentionally differs (50 vs 999) | 1 hour | Very low |
| 5 | Stringly-typed events | **VERIFIED** — 392 string-based calls, 0 constants | 2+ hours | None |
| 6 | Mixed color systems | **VERIFIED** — two palettes + 60+ hardcoded hex values | 3-4 hours | Low |
| 7a | Inventory namespace dead | **VERIFIED** — 332 lines, 0 active refs | 15 min | None |
| 7b | BankAccountEntity dead | **VERIFIED** — needs DB migration | 30 min + migration | Low |
| 7c | wantedLevel dead | **VERIFIED** — pushed but never consumed | 30 min + migration | Low |
| 7d | bankData in store dead | **VERIFIED** — no refs, hardcoded pincode | 5 min | None |
| 7e | Re-export shims | **VERIFIED** — functional but unnecessary | 1-2 hours | Low |
| 7f | Empty shared dirs | **VERIFIED** — scaffolding only | 5 min | None |
| 7g | Docs in source dirs | **VERIFIED** — not ideal location | 15 min | None |

---

## RECOMMENDED FIX ORDER

Based on verification, sorted by impact/effort ratio:

1. **Extract shared damage function** (Issue 1) — highest bug risk, easy fix
2. **Add vitals change detection to Hud.class.ts** (Issue 2) — trivial, immediate perf gain
3. **Extract shared MMR/XP calculation functions** (Issue 4) — high data integrity risk, easy fix
4. **Remove 332-line Inventory namespace** (Issue 7a) — instant code hygiene
5. **Remove bankData from Player.store** (Issue 7d) — 5 min, removes hardcoded pincode
6. **Create event name constants file** (Issue 5) — start incremental adoption
7. **Clean up timeout tracking in Arena.store** (Issue 3a) — low urgency but clean
8. **Consolidate color system** (Issue 6) — visual polish, medium effort
9. **Remove re-export shims** (Issue 7e) — clean up indirection
10. **Remove dead DB columns** (Issues 7b, 7c) — requires coordinated migration
