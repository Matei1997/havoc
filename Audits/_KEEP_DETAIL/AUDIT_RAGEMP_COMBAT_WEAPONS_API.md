# AUDIT: RAGE:MP Combat & Weapons API Usage

**Scope:** Player weapon APIs, weapon component/tint APIs, combat-related player/entity APIs, damage-related RAGE:MP usage  
**Source:** `ragemp-server/packages/server/index.js` (webpack-bundled TypeScript), `ragemp-server/client_packages/app.js`  
**Date:** 2026-04-25  
**Method:** Static source analysis — no live RAGE:MP wiki access confirmed; items requiring docs verification are marked accordingly  
**Note:** No `RAGEMP_API_INDEX.md` was found in the repository — analysis is derived directly from the compiled source bundle

---

## Section 1 — Player Weapon APIs (Native)

### 1.1 Give / Remove Weapons

| API | Line(s) | Verdict | Notes |
|-----|---------|---------|-------|
| `player.giveWeapon(hash, ammo)` | 6328 | ✓ CORRECT | Admin `/weapon` command; hash cast via `mp.joaat()` |
| `player.removeAllWeapons()` | 5945, 8071, 8301, 8409, 8765, 9005, 9113, 11210, 11426, 11554 | ✓ CORRECT | Called before spawning in all game modes (FFA, GunGame, Arena) and on death/leave |

### 1.2 Custom Extension: `giveWeaponEx`

```js
// Line 16842
mp.Player.prototype.giveWeaponEx = function(weapon, totalAmmo, _ammoInClip) {
    this.giveWeapon(weapon, totalAmmo);   // ammo-in-clip param silently ignored
};
```

**Status: CUSTOM EXTENSION — NOT NATIVE RAGE:MP API**

This method wraps `giveWeapon()` and adds a third parameter for ammo-in-clip, which is currently accepted but never used. Called at lines: 1704, 5902, 5925, 8073, 8768, 10459.

**Issue C09 (MEDIUM):** The ammo-in-clip parameter is silently dropped. Players spawning with weapons will always have a full magazine computed server-side rather than the specified clip count. This is a behavioral inconsistency, not a security issue.

---

## Section 2 — Weapon Component APIs

> **All methods in this section are CUSTOM SERVER-SIDE PROTOTYPE EXTENSIONS.**  
> They are NOT native RAGE:MP APIs. They extend `mp.Player.prototype` and maintain server-side state in `__weaponComponents` Map, synchronized to clients via the player variable `currentWeaponComponents`.

| Method | Line | Description |
|--------|------|-------------|
| `player.giveWeaponComponent(weaponHash, componentHash)` | 1633, 16951 | Adds attachment; stores in `__weaponComponents[weaponHash]` Set |
| `player.hasWeaponComponent(weaponHash, componentHash)` | 16972 | Returns bool — checks Set membership |
| `player.getWeaponComponents(weaponHash)` | 16981 | Returns `Array.from(map[u32(weaponHash)])` |
| `player.removeWeaponComponent(weaponHash, componentHash)` | 16990 | Removes single attachment from Set |
| `player.removeAllWeaponComponents(weaponHash)` | 1631, 16990 | Clears all attachments for one weapon |
| `player.resetAllWeaponComponents()` | 17031 | Wipes entire `__weaponComponents` map |

**Consistent pattern:** All hashes are coerced to uint32 via `u32(hash)` / `hash >>> 0` before use — correct.

**Sync mechanism:** On `playerWeaponChange`, the server calls the client with the serialized component Set for the new weapon hash. No native RAGE:MP component API (`setWeaponComponentTintIndex`, etc.) is used server-side — all component application happens client-side on receiving the sync.

**UNVERIFIED AGAINST LIVE DOCS:** Whether RAGE:MP exposes native server-side component APIs (e.g., a real `player.giveWeaponComponent`) was not confirmed against the live wiki. The custom implementation effectively replaces any native equivalent.

---

## Section 3 — Weapon Tint APIs

> **All methods in this section are CUSTOM SERVER-SIDE PROTOTYPE EXTENSIONS.**  
> Tints are stored in `__weaponTints` object keyed by uint32 weapon hash, synced to clients via player variable `currentWeaponTint` as the string `"weaponHash|tintIndex"`.

| Method | Line | Description |
|--------|------|-------------|
| `player.setWeaponTint(weaponHash, tintIndex)` | 17040 | Stores `tints[u32(weaponHash)] = tintIndex` |
| `player.getWeaponTint(weaponHash)` | 17054 | Returns `tints[u32(weaponHash)] \|\| 0` |
| `player.getAllWeaponTints()` | 17063 | Returns entire `__weaponTints` object |
| `player.resetAllWeaponTints()` | 17067 | Clears `__weaponTints` |

**No validation** of `tintIndex` range (valid GTA V values: 0–8). An out-of-range value propagates to the client unchecked.

**UNVERIFIED AGAINST LIVE DOCS:** Whether RAGE:MP exposes native server-side tint APIs was not confirmed.

---

## Section 4 — Health & Armor APIs

### 4.1 Native Property Access

| Property | Line(s) | Mode | Notes |
|----------|---------|------|-------|
| `player.health` | 6343, 8089, 8122, 8147, 8782, 8815, 8837 | Read/Write | Set to `0` to kill; range 0–100 in RAGE:MP |
| `player.armour` | 5647, 5674, 5699, 5722, 8090, 8783, 16947 | Read/Write | British spelling used throughout |

Both spellings (`armour` / `armor`) appear in the codebase. RAGE:MP uses `player.armour` (British). Usage of `armor` at some sites may be custom variable names rather than the native property — not a defect.

### 4.2 Custom Helper: `setVitals`

```js
// Line 5645
function setVitals(player, health, armor) {
    player.health = health;
    player.armour = armor;
    player.call(ClientEvents.PLAYER_SET_VITALS, [health, armor]);
}
```

**Status: CUSTOM HELPER — NOT NATIVE**  
Correctly sets both native properties and fires a client event to update HUD. No misuse.

---

## Section 5 — Combat Events

### 5.1 Death Events

| Event | Line | Handler |
|-------|------|---------|
| `mp.events.add("playerDeath", ...)` | 19477 | Routes to `handleFfaDeath` / `handleGunGameDeath` / `handleArenaDeath` depending on active match; falls back to freeroam respawn |
| `mp.events.add("server::player:acceptDeath", ...)` | 19478 | Manual respawn trigger → `respawnFreeroamAtLegionSquare(player)` |

### 5.2 Damage / Hit Events (Client-Reported)

| Event | Line | Parameters | Validation Present |
|-------|------|------------|--------------------|
| `server:PlayerHit` | 19285 | `(shooter, victimId, targetBone, weaponHash)` | Fire rate check, duplicate hit guard, dimension check, team damage check |
| `server:BotPedHit` | 19396 | `(shooter, pedId, hitX, hitY, hitZ, targetBone, weaponHash)` | Partial |

### 5.3 Weapon State Events

| Event | Line | Purpose |
|-------|------|---------|
| `playerWeaponChange` | 17078 | Syncs `__weaponComponents` and `__weaponTints` for the newly equipped weapon to client |
| `WEAPON_PRESET_ENSURE_APPLIED` | 1805 | Reapplies attachments and recoil overrides on weapon swap |

### 5.4 Zone / Colshape Events

| Event | Line | Handler |
|-------|------|---------|
| `playerEnterColshape` | 20469 | `shape.enterHandler(player)` — zone entry (OOB, match areas, death zones) |
| `playerExitColshape` | 20473 | `shape.exitHandler(player)` — zone exit |

Used in FFA/GunGame for out-of-bounds kill: `player.health = 0` applied server-side (line 8147) after timeout in zone.

---

## Section 6 — Player Weapon Property Access

| Property / Variable | Line(s) | Type | Notes |
|--------------------|---------|------|-------|
| `player.weapon` | 6746, 16965, 17050, 17073 | **Native read-only** | Returns current weapon hash as uint32 |
| `currentWeapon` (variable) | 16966, 17004, 17035, 17088 | Server-side tracking variable | Stored separately from the native property |

---

## Section 7 — Ammo Configuration

| Constant | Location | Value | Context |
|----------|---------|-------|---------|
| `FFA_AMMO` | Config, line 8073 | (configured value) | Given on FFA spawn |
| `GUNGAME_AMMO` | Config, line 8768 | (configured value) | Given per tier in Gun Game |
| `ARENA_AMMO` | Config, line 10459 | (configured value) | Given at Arena round start |

All ammo distribution goes through `giveWeapon(hash, ammo)` or `giveWeaponEx(hash, ammo, _clip)`. No ammo manipulation via events or unsanctioned paths found.

---

## Section 8 — Combat Integrity Checks Found

Located within the `CombatIntegrity` module, called from the `server:PlayerHit` handler (lines 19293–19300):

| Check | Purpose |
|-------|---------|
| `validateFireRate(shooterId, weaponHash)` | Prevents rapid-fire exploit per weapon type |
| `validateDuplicateHit(shooterId, victimId)` | Blocks duplicate damage packets within a time window |
| `getTimeSinceLastShot(shooterId)` | Tracks last shot timestamp per player |

These are defensive server-side guards. Their existence is correct; their adequacy is assessed in the issues section below.

---

## Section 9 — Match-Specific Weapon Distribution

### FFA Mode
- Spawn weapons: `FfaConfig.FFA_WEAPONS` array
- Strip: `player.removeAllWeapons()` (line 8071) then `giveWeapon()` per weapon (line 8073)
- Death handler: `handleFfaDeath(player, killer)` (line 19460)

### Gun Game Mode
- Tier-based weapon: `match.weaponOrder[tier]` (line 8767)
- Single weapon per tier distributed via `giveWeaponEx()`
- Death handler: `handleGunGameDeath(player, killer)` (line 19464)

### Arena Mode
- Round weapons: `giveRoundWeapons(player, weapons)` (line 10455)
- Weapon presets enforced: `applyWeaponPresets(player, weaponHashes)` (line 10461)
- Death handler: `handleArenaDeath(player, killer)` (line 19468)

---

## Section 10 — Issues Found

### CRITICAL

| ID | Location | API Involved | Problem |
|----|----------|--------------|---------|
| **C01** | `DamageSync.event.ts:172` (bundle line ~19285) | `mp.players.at(victimId)` | **Wrong lookup method.** `mp.players.at()` resolves by internal sequential ID. `mp.players.atRemoteId()` is required to resolve by the client-reported remote ID. Under concurrent joins/leaves this maps damage to the wrong player or returns `undefined`, causing either missed damage or phantom hits. **UNVERIFIED AGAINST LIVE DOCS** — but this is a well-established RAGE:MP API distinction. |
| **C04** | `DamageSync.event.ts:244,261` (bundle ~line 19290) | `player.health` write during warmup | **Warmup godmode bypassed.** Warmup/frozen state is not checked before applying incoming `server:PlayerHit` damage. A frozen player's health can be reduced to zero during the pre-round countdown. |
| **C07** | `DamageSync.event.ts` (bundle ~line 19285) | `server:PlayerHit` handler | **Dead players can deal damage.** The shooter's alive status is not verified before processing hit events. A dead player's client can still emit `server:PlayerHit` and the server processes it. |
| **C08** | `DamageSync.event.ts` (bundle ~line 19285) | `weaponHash` (client-reported) | **Weapon hash not whitelisted.** The `weaponHash` sent by the client in `server:PlayerHit` is cast to uint32 and used for damage lookup, but is never validated against a known-good weapon hash list. An attacker can report an arbitrary hash and receive fallback damage values. |

### MEDIUM

| ID | Location | API Involved | Problem |
|----|----------|--------------|---------|
| **C09** | Line 16842 | `player.giveWeaponEx()` (custom) | The `ammoInClip` parameter is accepted in the function signature but passed to `giveWeapon(hash, totalAmmo)` — the clip count is silently ignored. Players always spawn with RAGE:MP's default clip fill. |

### LOW

| ID | Location | API Involved | Problem |
|----|----------|--------------|---------|
| **C10** | Line 17078 (`playerWeaponChange`) | Component sync | No debouncing. Fires on every weapon swap including weapon cycling with no equipped weapons. Serializes and transmits component/tint state even when no changes occurred since the last swap. |

---

## Section 11 — APIs Expected but NOT Found

The following combat/weapon-related RAGE:MP APIs were searched for and are **absent** from the codebase:

- `player.currentWeapon` (native property, read) — not accessed; custom variable used instead
- `player.currentAmmo` / `player.weaponAmmo` — not used; ammo is not tracked server-side post-spawn
- `player.hasWeapon()` (native) — not used; custom `hasWeaponComponent` covers a different concern
- `player.weapons` (property, if it exists) — not accessed
- `entityDamage` event — not registered; damage is fully client-reported via `server:PlayerHit`
- `playerWeaponShot` event — not registered

**UNVERIFIED AGAINST LIVE DOCS:** Whether `playerWeaponShot` and `entityDamage` exist as native RAGE:MP server events was not confirmed against live wiki.

---

## Summary

| Category | Count |
|----------|-------|
| Native RAGE:MP weapon APIs used correctly | 2 (`giveWeapon`, `removeAllWeapons`) |
| Custom server prototype extensions (weapon/component/tint) | 10 |
| Custom helper functions | 1 (`setVitals`) |
| Combat event handlers registered | 5 |
| CRITICAL issues | 4 (C01, C04, C07, C08) |
| MEDIUM issues | 1 (C09) |
| LOW issues | 1 (C10) |

**Highest risk surface:** The `server:PlayerHit` handler is fully client-driven with incomplete server-side validation (C01, C04, C07, C08). All four critical issues converge on this single event handler.
