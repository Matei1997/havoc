# AUDIT_DAMAGE_COMBAT.md — Damage / Combat Pipeline Subsystem

**Date:** 2026-04-24
**Auditor:** Claude Sonnet 4.6 (hostile read-only pass)
**Scope:** `DamageSync.module.ts` (client), `DamageSync.event.ts` (server), `CombatIntegrity.ts`, `SnapshotManager.ts`, `DeathRecapTracker.ts`
**RAGE:MP wiki:** https://wiki.rage.mp/wiki/Main_Page — returned HTTP 403 during audit. All RAGE:MP API behavior is marked **UNVERIFIED AGAINST LIVE DOCS**. No API calls or command codes were invented; all references are taken directly from source files read.

---

## Event Flow

```
CLIENT (DamageSync.module.ts)
  playerWeaponShot fires → targetEntity identified
  getHitBone(targetPosition, target) → bone name (client-computed, distance-based)
  mp.players.local.weapon.toString() → weaponHash (client-controlled)
  mp.events.callRemote("server:PlayerHit", target.remoteId, bone, weaponHash)

SERVER (DamageSync.event.ts:170)
  shooter = first handler param (RAGE:MP-guaranteed identity)
  victimId = client-provided (remoteId)

  1. mp.players.at(victimId)           ← WRONG API — uses pool index not remoteId [DC-C01]
  2. shooter.id === victim.id check    ← self-shot guard ✓
  3. validateFireRate(shooter.id, weaponHash)   [CombatIntegrity]
  4. validateDuplicateHit(shooter.id, victim.id) [CombatIntegrity]
  5. dimension check ✓
  6. team check (Hopouts) ✓ — edge case bug [DC-M01]
  7. getRewindPosition(victim.id, shotTime)     [SnapshotManager — lag compensation]
  8. validateDistance(weaponHash, distance)     [CombatIntegrity]
  9. getWeaponDamage(weaponHash, dist) × getBoneMultiplier(bone)

  Mode dispatch:
    ffaMatch.state === "active"      → applyArenaModeDamage(..., handleFfaDeath, "afterArmor")
    gunGameMatch.state === "active"  → applyArenaModeDamage(..., handleGunGameDeath, "afterArmor")
    hopoutsMatch.state === "active"  → applyArenaModeDamage(..., handleArenaDeath, "beforeArmor")
    else (freeroam fallback)         → uncapped damage, NO state check [DC-C04]

  recordDamageToVictim / recordDamageDealt  [DeathRecapTracker]
  client:ShowHitmarker → shooter
  PLAYER_SET_VITALS → victim
```

---

## Trust Boundary Summary

| Parameter | Source | Server-verified? | Risk |
|---|---|---|---|
| `shooter` | RAGE:MP server (always actual sender) | Implicit — guaranteed by framework | None |
| `victimId` | Client-sent `target.remoteId` | Existence check only; fetched via **wrong API** | **CRITICAL** DC-C01 |
| `targetBone` | Client-computed string | Accepted as-is for 1.5× multiplier | **HIGH** DC-H14 |
| `weaponHash` | `mp.players.local.weapon.toString()` | Not whitelisted; falls back to defaults | **CRITICAL** DC-C08 |
| `shooter.ping` | Server-side RAGE:MP metric | N/A — not client-controlled | Good |
| `distance` | Server-computed from positions + lag comp | Lag-compensated using server snapshots | Good |

---

## 1. Critical Findings

### DC-C01 — `mp.players.at(victimId)` uses pool index, not remote ID
**File:** `DamageSync.event.ts:172`
**Severity:** CRITICAL — confirms existing finding C01; directly verified

```typescript
mp.events.add("server:PlayerHit", (shooter: PlayerMp, victimId: number, ...) => {
    if (!shooter || !mp.players.exists(shooter)) return;
    const victim = mp.players.at(victimId);   // ← WRONG: at() takes pool index
    if (!victim || !mp.players.exists(victim)) return;
```

The client sends `target.remoteId` (line 90 of `DamageSync.module.ts`):
```typescript
mp.events.callRemote("server:PlayerHit", target.remoteId, bone, weaponHash);
```

On the server, `victimId` is the player's **remote ID** (network identifier). `mp.players.at(index)` iterates the internal pool **by pool index**, not by remote ID. The correct method is `mp.players.atRemoteId(id)`.

**RAGE:MP wiki (UNVERIFIED AGAINST LIVE DOCS):** Based on RAGE:MP API naming conventions and training data: `mp.players.at(index)` resolves by internal pool position; `mp.players.atRemoteId(id)` resolves by the network remote ID. These are different values on any server with more than one connected player or after any disconnections (pool indices can be reused).

**Impact:** Damage is applied to a **different player** than the one actually shot. On a server with player IDs > 0, `mp.players.at(remoteId)` will return a random other player or `undefined`. The `mp.players.exists(victim)` check catches `undefined` and silently drops the event, meaning most hits do nothing. When a valid (wrong) player is found, damage hits them instead. The entire combat system is broken at its root.

**Fix:**
```typescript
const victim = (mp.players as any).atRemoteId
    ? (mp.players as any).atRemoteId(victimId)
    : mp.players.at(victimId);
```
Or, once confirmed available in the deployed RAGE:MP version:
```typescript
const victim = mp.players.atRemoteId(victimId);
```

---

### DC-C04 — Warmup state falls through to uncapped freeroam damage block
**File:** `DamageSync.event.ts:220–276`
**Severity:** CRITICAL — confirms existing finding C04; directly verified

```typescript
if (ffaMatch && ffaMatch.state === "active") {          // warmup → false
    damageToShow = applyArenaModeDamage(...);
} else if (gunGameMatch && gunGameMatch.state === "active") { // warmup → false
    damageToShow = applyArenaModeDamage(...);
} else if (hopoutsMatch && hopoutsMatch.state === "active") { // warmup → false
    damageToShow = applyArenaModeDamage(...);
} else {
    // Freeroam: apply damage on server so it actually registers
    let dmgLeft = finalDamage;
    if (victim.armour > 0) { /* drain armour */ }
    if (dmgLeft > 0) { victim.health = Math.max(0, victim.health - dmgLeft); }
    // ← no state check, no warmup guard, no damage cap
}
```

When a player is in any match with `state !== "active"` (e.g., `"warmup"`), all three mode-specific conditions evaluate to `false` (match exists but wrong state). Execution falls into the `else` block and applies full, uncapped damage.

**Impact:** Players can be killed during warmup by any opposing player. Warmup is intended to be a safe preparation phase (frozen players, no scoring, no deaths). Any client can exploit this by firing during warmup.

**Fix:** Add a guard before the `else` block:
```typescript
} else if (ffaMatch || gunGameMatch || hopoutsMatch) {
    // Match exists but not in active state (warmup, cooldown, etc.) — ignore all damage
    return;
} else {
    // True freeroam — no match context
```

---

### DC-C07 — No alive/dead check on the shooter
**File:** `DamageSync.event.ts:170–173`
**Severity:** CRITICAL — confirms existing finding C07; directly verified

```typescript
mp.events.add("server:PlayerHit", (shooter: PlayerMp, victimId: number, ...) => {
    if (!shooter || !mp.players.exists(shooter)) return;  // ← existence only
    const victim = mp.players.at(victimId);
    if (!victim || !mp.players.exists(victim)) return;
    if (shooter.id === victim.id) return;
    // ← no check: shooter.getVariable("alive") !== false
    // ← no check: shooter.health > 0
```

A dead player's client can continue firing `server:PlayerHit` events. The server performs no check on whether the shooter is currently alive. `mp.players.exists` returns true as long as the RAGE:MP object is valid, regardless of game state.

**Impact:** Dead players can kill living opponents. Kill credit goes to a dead player. Stats are corrupted.

**Fix:**
```typescript
if (shooter.getVariable("alive") === false) return;
// or, if no "alive" variable is reliably set in all modes:
if (shooter.health <= 0) return;
```

---

### DC-C08 — Weapon hash not validated against a whitelist
**Files:** `DamageSync.event.ts:104–105`, `CombatIntegrity.ts:72–76`
**Severity:** CRITICAL — confirms existing finding C08; directly verified

In `getWeaponDamage`:
```typescript
const w = weaponDamage[weaponHash] ??
    { base: DEFAULT_WEAPON_BASE, min: DEFAULT_WEAPON_MIN, effectiveRange: DEFAULT_EFFECTIVE_RANGE };
//    ↑ unknown hash → silently falls back to DEFAULT_WEAPON_BASE=28
```

In `getMaxDistanceForWeapon` (CombatIntegrity.ts):
```typescript
const explicit = weaponMaxDistance[weaponHash];
if (explicit !== undefined) return explicit;
return DEFAULT_MAX_DISTANCE_M;  // ← unknown hash → 100m default
```

A client can send any string as `weaponHash`. Unknown hashes are not rejected; they receive fallback damage values (28 base, 100m max range) and are fully processed through the damage pipeline. Combined with DC-H14 (client-controlled bone), a cheater can claim any hash to manipulate which damage/distance table entry is used.

**Impact:** A cheater claiming a sniper hash gets sniper-range validation (up to 450m) while dealing different damage. A cheater claiming an unknown hash gets 100m range + 28 base damage + accepted through the pipeline.

**Fix:** Reject any `weaponHash` not present in `weaponDamage`:
```typescript
if (!weaponDamage[weaponHash]) return;  // reject unknown hashes immediately
```

---

## 2. High Findings

### DC-H14 — Client-controlled bone determines 1.5× headshot multiplier
**Files:** `DamageSync.event.ts:210`, `DamageSync.module.ts:88`
**Severity:** HIGH — confirms existing finding H14; directly verified

Client-side (DamageSync.module.ts:88):
```typescript
const bone = getHitBone(targetPosition, target);  // client-computed string
mp.events.callRemote("server:PlayerHit", target.remoteId, bone, weaponHash);
```

Server-side (DamageSync.event.ts:210):
```typescript
const isHead = targetBone === "Head";
// ...
const boneMult = getBoneMultiplier(targetBone);  // Head = 1.5×, all others = 1×
```

The `targetBone` string is sent by the client and accepted directly. A modified client always sends `"Head"` to guarantee 1.5× damage multiplier on every shot.

The headshot ratio logger in `CombatIntegrity.ts:158–174` only emits a `console.warn` at >90% ratio — it does not kick, flag, reduce damage, or report to the admin panel.

**Impact:** Modified clients deal 1.5× damage on every hit indefinitely. No enforcement action is taken.

**Mitigation options:**
1. Server-side bone re-calculation using victim's actual bone coordinates at shot time (expensive, RAGE:MP API availability UNVERIFIED AGAINST LIVE DOCS)
2. Cap headshot ratio enforcement: if shooter's last N kills are >80% headshots, remove the multiplier for subsequent hits from that shooter
3. Log to admin panel (not just console.warn) so admins can manually review

---

## 3. Medium Findings

### DC-M01 — Team damage check edge case: undefined team allows friendly fire
**File:** `DamageSync.event.ts:194–197`
**Severity:** MEDIUM — new finding

```typescript
const victimTeam = getTeam(match, victim.id);
const shooterTeam = getTeam(match, shooter.id);
if (victimTeam && shooterTeam && victimTeam === shooterTeam) return;
```

If either `victimTeam` or `shooterTeam` is `undefined` (player exists in the match data structure but has no team assignment — possible during the brief window between joining the match and team assignment), the `&&` short-circuits and team damage is **not blocked**.

**Impact:** Edge-case friendly fire during match join race condition.

**Fix:** Fail-closed: if either team is undefined, block the damage:
```typescript
if (!victimTeam || !shooterTeam || victimTeam === shooterTeam) return;
```

---

### DC-M02 — `server:BotPedHit` bypasses all CombatIntegrity validation
**File:** `DamageSync.event.ts:307–329`
**Severity:** MEDIUM — new finding

```typescript
mp.events.add("server:BotPedHit", (shooter: PlayerMp, pedId: number, ...) => {
    if (!shooter || !mp.players.exists(shooter)) return;
    const ped = getPedById(pedId);
    if (!ped || !mp.peds.exists(ped) || !ped.getVariable("isBot")) return;

    const distance = Utils.distanceToPos(shooter.position, { x: hitX, y: hitY, z: hitZ });
    const weaponDmg = getWeaponDamage(weaponHash, Math.max(1, distance));
    // ← NO validateFireRate()
    // ← NO validateDuplicateHit()
    // ← NO validateDistance()
```

The `server:BotPedHit` handler skips all three `CombatIntegrity` checks. A client can spam bot hits with no fire rate limit, no duplicate cooldown, and no distance cap.

**Impact:** Limited to game modes that use bots (e.g., `/bot` command scenarios), but a cheating player can rapidly kill bot peds, potentially exploiting XP or challenge rewards tied to bot kills.

**Fix:** Add the same validation calls:
```typescript
if (!validateFireRate(shooter.id, weaponHash).allowed) return;
if (!validateDuplicateHit(shooter.id, pedId).allowed) return;
if (!validateDistance(weaponHash, distance).allowed) return;
```

---

### DC-M03 — `getPedById` fallback may use pool index instead of remote ID
**File:** `DamageSync.event.ts:295–303`
**Severity:** MEDIUM — new finding; same class of bug as DC-C01

```typescript
function getPedById(pedId: number): PedMp | undefined {
    if ((mp.peds as any).atRemoteId) return (mp.peds as any).atRemoteId(pedId);
    const ped = mp.peds.at(pedId);
    if (ped && mp.peds.exists(ped) && (ped as any).id === pedId) return ped;
    // ← fallback loop also checks .id === pedId
    for (let i = 0; i < (mp.peds.length ?? 0); i++) {
        const p = mp.peds.at(i);
        if (p && mp.peds.exists(p) && (p as any).id === pedId) return p;
    }
    return undefined;
}
```

The client sends `targetEntity.remoteId` as `pedId` (DamageSync.module.ts:102). If `mp.peds.atRemoteId` is unavailable (runtime check at line 296), the fallback uses `mp.peds.at(pedId)` (pool index) with a `(ped as any).id === pedId` validation. If `ped.id` is the pool index and `pedId` is the remote ID, these will mismatch and the fallback loop runs. The loop's `(p as any).id === pedId` check has the same ambiguity — `p.id` may be pool index, not remote ID.

**UNVERIFIED AGAINST LIVE DOCS:** Behavior depends on whether RAGE:MP sets `.id` to pool index or remote ID on ped entities.

**Impact:** If `atRemoteId` is unavailable and `ped.id` is pool index (not remoteId), no ped is ever found — the `isBot` guard fails and hits are silently dropped. Or wrong ped is targeted. Same class of bug as DC-C01.

---

## 4. Warmup / Active State Handling Summary

| Mode | State guard | Fallthrough behavior |
|---|---|---|
| FFA | `ffaMatch.state === "active"` ✓ | warmup → falls to freeroam block ✗ |
| GunGame | `gunGameMatch.state === "active"` ✓ | warmup → falls to freeroam block ✗ |
| Hopouts/Arena | `hopoutsMatch.state === "active"` ✓ | warmup → falls to freeroam block ✗ |
| Freeroam fallback | No guard | Fires for any player not in an active match, **including warmup players** ✗ |

The fundamental design issue: the `else` fallback is intended for players in no match (true freeroam), but it fires for **any** player whose match exists but is not in `"active"` state. The fix requires distinguishing "in a match but not active" from "in no match at all."

---

## 5. Shooter / Victim Identity Summary

| Check | Location | Status |
|---|---|---|
| Shooter identity | RAGE:MP event system | Guaranteed ✓ |
| Victim identity | `mp.players.at(victimId)` | **WRONG API** — see DC-C01 ✗ |
| Self-shot prevention | `shooter.id === victim.id` | Present ✓ |
| Shooter alive check | None | **MISSING** — see DC-C07 ✗ |
| Victim alive check | Implicit: `victim.health > 0` in damage path | Partial (not checked pre-handler) |
| Dimension check | `shooter.dimension !== victim.dimension` | Present ✓ |
| Team damage (Hopouts) | `victimTeam === shooterTeam` | Present but edge-case gap — see DC-M01 |

---

## 6. Weapon Hash Validation Summary

| Table | Known weapons | Unknown hash behavior |
|---|---|---|
| `weaponDamage` (DamageSync.event.ts) | 26 weapons | Falls back to `DEFAULT_WEAPON_BASE=28` — **not rejected** ✗ |
| `weaponRPM` (CombatIntegrity.ts) | 26 weapons | Falls back to `DEFAULT_MIN_SHOT_INTERVAL_MS=100ms` — not rejected |
| `weaponMaxDistance` (CombatIntegrity.ts) | 26 weapons | Falls back to `DEFAULT_MAX_DISTANCE_M=100m` — **not rejected** ✗ |

---

## 7. RAGE:MP API Notes

> All items below are **UNVERIFIED AGAINST LIVE DOCS** — wiki returned 403.

| API | Location | Concern |
|---|---|---|
| `mp.players.at(index)` vs `mp.players.atRemoteId(id)` | `DamageSync.event.ts:172` | `at()` = pool index; `atRemoteId()` = network remote ID. DC-C01 fix depends on `atRemoteId` existing in deployed version. |
| `mp.peds.atRemoteId` | `DamageSync.event.ts:296` | Runtime existence check (`if ((mp.peds as any).atRemoteId)`) suggests this may not exist in all RAGE:MP builds. |
| `player.health <= 0` death check | `DamageSync.event.ts:155` | In GTA V native, `player.health` base is 100 (full = 200; dead threshold < 100 in native). If RAGE:MP exposes raw GTA health (0–200), the `<= 0` check only fires after full drain. If RAGE:MP normalizes health differently, death detection may be off. **Needs live verification.** |
| `player.getBoneCoords(boneId, 0, 0, 0)` | `DamageSync.module.ts:37` | Used for client-side bone distance calculation. UNVERIFIED AGAINST LIVE DOCS. |

---

## 8. CombatIntegrity — Detection-Only Safeguards (Not Enforcement)

The following checks in `CombatIntegrity.ts` **log only** and take no enforcement action:

| Check | Threshold | Action | Gap |
|---|---|---|---|
| Headshot ratio | >90% of last 10 kills | `console.warn` | No kick, no flag, no admin alert |
| Suspicious short interval | Hit < 25ms after last shot | `console.warn` | No rejection, no penalty |

These are useful for debugging but provide zero protection against cheaters who know the logs are not acted upon. Consider:
1. Flagging the player's account for admin review
2. Emitting to the admin audit log (not in-memory console)
3. Automatic temporary damage reduction after N suspicious events

---

## 9. Lag Compensation Notes

`SnapshotManager.ts` records player positions every 50ms (max 20 snapshots = 1 second of history).

`DamageSync.event.ts:202–204`:
```typescript
const shotTime = Date.now() - (shooter.ping / 2);  // one-way delay estimate
const rewindVictimPos = getRewindPosition(victim.id, shotTime);
const victimPosForDistance = rewindVictimPos ?? victim.position;
```

- `shooter.ping / 2` as one-way RTT estimate: server-controlled value, not client-spoofable ✓
- Fallback to current position if no snapshot available ✓
- Lag compensation is only used for **distance validation**, not for bone/hit detection

**No issues found in lag compensation implementation.** The design correctly uses server-side snapshots (not client-reported position) for distance calculation.
