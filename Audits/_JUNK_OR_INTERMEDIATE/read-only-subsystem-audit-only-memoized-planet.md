# Plan: Hopouts Arena Audit → AUDIT_HOPOUTS_ZONE_SPAWNS.md

## Context
Read-only correctness/integrity audit of the Hopouts arena subsystem on a RAGE:MP server.
No code is modified. Output is a single markdown audit report.

## Files Audited (all read directly)
- `gamemode/source/server/modes/hopouts/ArenaMatch.manager.ts` (1844 lines)
- `gamemode/source/server/modes/hopouts/ZoneSystem.ts` (437 lines)
- `gamemode/source/server/modes/hopouts/ArenaSpawn.validation.ts` (95 lines)
- `gamemode/source/server/modes/hopouts/ArenaConfig.ts`
- `gamemode/source/server/modes/hopouts/Arena.module.ts`
- `gamemode/source/server/modes/hopouts/hopoutsVitalsSync.ts`
- `gamemode/source/server/modes/hopouts/HopoutsZones.runtime.ts`
- `gamemode/source/server/modes/hopouts/HopoutsZoneRuntime.runtime.ts`
- `gamemode/source/server/modes/hopouts/HopoutsZoneRuntimeConfig.asset.ts`
- `gamemode/source/server/modes/hopouts/HopoutsZones.asset.ts`
- `gamemode/source/server/modules/matches/ReconnectManager.ts`
- `gamemode/source/server/modules/matches/SpawnHelpers.ts`
- `gamemode/source/server/modules/matches/MatchManager.ts`
- `gamemode/source/server/modules/matches/MatchRegistry.ts`
- `gamemode/source/server/modules/matches/TeamPing.service.ts`
- `gamemode/source/client/modules/ArenaZone.module.ts` (574 lines)
- `gamemode/source/client/modules/ArenaVitals.module.ts` (stub)
- `gamemode/source/client/modules/ArenaSpectateController.module.ts` (90 lines)
- `gamemode/source/server/serverevents/Death.event.ts`
- `gamemode/source/server/serverevents/DamageSync.event.ts`
- `gamemode/source/server/serverevents/Player.event.ts`

---

## Verified Findings

### HIGH

**H1 — Null dereference in spawn fallback (ArenaSpawn.validation.ts:60)**
```typescript
const ref = preset.center ?? { x: preset.redSpawn.x, y: preset.redSpawn.y, z: zMed };
```
`preset.center` is typed required but external JSON can be malformed. If `center` is null at
runtime AND `redSpawn` is also absent, this throws `TypeError: Cannot read properties of
undefined`. No try/catch wraps `isHopoutsSpawnGeometricallySafe`. Uncaught TypeErrors in
RAGE:MP propagate to process level — potential server crash on malformed preset load.

**H2 — Stale disconnect setTimeout fires on subsequent round in 1v1 matches (ArenaMatch.manager.ts:1590-1597)**
```typescript
if (match.state === "active" && matchPlayer.alive) {
    setTimeout(() => {
        if (!getMatchByDimension(match.dimension)) return;
        if (match.state !== "active") return;   // ← captured match object
        checkRoundEnd(match);
    }, roundPresenceGraceMs); // 15s
}
```
Round transitions: roundEndDelay (3s) + warmupDuration (3s) = 6s before next round goes active.
The 15s grace timeout fires 9s into Round N+1's active phase. Both guards pass (match still exists;
state IS "active"). `checkRoundEnd` runs on Round N+1's data, with the disconnected player's
`roundPresenceDeadline` expired and `disconnected=true` still set (beginRound resets `alive`
but NOT `disconnected`/`roundPresenceDeadline` flags). In a 1v1 where the disconnected player
is the only member of their team, `getAlivePlayers` returns 0 for that team → `completeRound`
fires prematurely, ending Round N+1 after ~9s of real play.

**H3 — beginRound does not clear disconnected/roundPresenceDeadline for next round (ArenaMatch.manager.ts:1198-1199)**
```typescript
match.redTeam.forEach((p) => (p.alive = true));   // resets alive only
match.blueTeam.forEach((p) => (p.alive = true));  // disconnected + deadline NOT cleared
```
Combined with H2: a player who disconnected in Round N still carries `disconnected=true` and
a past `roundPresenceDeadline` into Round N+1, making them invisible to `getAlivePlayers` from
the first tick of the new round.

### MEDIUM

**M1 — stormDamageBank memory leak on disconnect (ZoneSystem.ts:62,110)**
Bank is keyed by `player.id` (session-scoped). On disconnect, `handleMatchDisconnect` clears
zone presence but NOT the damage bank entry. On reconnect the player gets a new `player.id`
(RAGE:MP assigns new IDs per session). Old entry is orphaned until `stopZone` (match end).
In high-churn scenarios (many disconnects per match) this accumulates unbounded entries.
No damage-on-reconnect occurs (new id → fresh bank), but the leak is real.

**M2 — outOfBoundsStart.clear() clears ALL players when match not found (ZoneSystem.ts:112)**
```typescript
} else {
    outOfBoundsStart.clear();   // global clear — affects other dimensions
}
```
The `else` branch runs when `getMatchByDimension(dimension)` returns null inside `stopZone`.
`outOfBoundsStart` is a module-level Map keyed by playerId (not dimension). If a match's
dimension lookup fails at cleanup time, ALL in-progress OOB tracking for every active match
is wiped. Low probability but cross-dimension side-effect.

**M3 — Reconnect restores full item counts regardless of previously used items (ArenaMatch.manager.ts:1469-1470)**
```typescript
const medkits = ITEM_CONFIG.medkit.countPerRound;   // always 3
const plates  = ITEM_CONFIG.plate.countPerRound;    // always 3
```
A player who used 2 medkits, disconnected, and reconnected within 60s receives 3 medkits again.
Disconnect-reconnect cycle effectively functions as item refresh exploit.

**M4 — ArenaZone.module.ts reconnect sends stale initial radius 200 (ArenaMatch.manager.ts:1507)**
```typescript
player.call(ClientEvents.ARENA_ZONE_INIT, [cx, cy, 200]);
```
`ARENA_ZONE_INIT` always passes `200` as initial radius. If the reconnecting player joins mid-
shrink (e.g., zone already at radius 70), the minimap ring momentarily shows 200 before the
first ARENA_ZONE_UPDATE corrects it (200ms max). Creates a visual ghost ring at the wrong radius.

**M5 — Custom zone polygon winding order not validated (HopoutsZones.runtime.ts)**
Ray-casting polygon algorithm assumes consistent vertex winding. No validation enforced during
zone upload. Reversed winding produces inverted inside/outside classification for polygon zones.
Admin-facing only, but silently broken data causes players to be "inside" when outside or vice
versa (zone presence tracking, item blocking mode).

**M6 — filterSpawnPointsWithPeerZConsensus passes unfiltered with < 3 points (ArenaSpawn.validation.ts:74-78)**
```typescript
if (teamPoints.length < 3) return teamPoints;
```
Presets with only 1 or 2 authored spawn points per team bypass peer-Z outlier rejection entirely.
A single bad spawn point (roof, water) is not caught if it's the only point or one of two.

### FAIRNESS / INTEGRITY

**F1 — Storm damage bypasses armor (ZoneSystem.ts:228-249)**
Storm DPS subtracts from `player.health` only; `player.armour` is untouched. Players with full
armor (100) receive zero armor benefit in storm. Consistent with BR genre conventions but
explicitly asymmetric: a player in the storm with 100 armor and 1 HP dies next tick, while one
outside with 1 HP and 0 armor survives indefinitely.
*Design choice — marked for awareness.*

**F2 — Disconnect in 1v1 final: opponent waits up to 15s for round resolution**
By design, disconnected player counts as alive for `roundPresenceGraceSeconds` (15s).
In a 1v1 last-alive scenario, the remaining player must wait 15s idle. Storm keeps ticking;
no UI indicator that opponent disconnected vs. is repositioning.

**F3 — Simultaneous deaths produce draw round (ArenaMatch.manager.ts:1320)**
Both teams reaching alive=0 on the same `checkRoundEnd` call → `roundWinner = "draw"`.
Score not incremented. Neither team advances. Correct and symmetric, but a draw round in a
best-of-7 match can meaningfully extend match duration without progress.

**F4 — Spawn pair rotation: same pair CAN repeat after reset (ArenaMatch.manager.ts:340-348)**
When all pairs in the pool are exhausted, `used.clear()` resets the bag. The next selection is
random from the full pool (`Math.floor(Math.random() * selectable.length)`), and `lastSpawnPairKey`
check prevents the immediately-prior pair from repeating. With a pool of exactly 2 pairs,
rotation is: A → B → A → B (correct, never same consecutive). With pool size 1, same spawn
every round (fallback). *Behavior is acceptable for most cases.*

**F5 — Team assignment: group overflow routing is greedy, not balanced (Arena.module.ts:381-388)**
Greedy bin-packing assigns parties to whichever team has space. With uneven party sizes,
the final team sizes can differ by up to `(partySize - 1)` players. No post-assignment
balancing pass. In queue-mode (not custom), a 3-player party can land on a team with 1 slot
left, splitting the overflow to the other team, making the groups asymmetric.

**F6 — Weapon vote tie resolution: random winner from ALL options, not tied options only (ArenaMatch.manager.ts:473-476)**
```typescript
const winnerPool = tied.length > 0 ? tied : options;
```
Wait — re-reading: `tied` = options that match `maxVotes`. If maxVotes=0 (no votes cast),
ALL options have 0 votes → `tied = options` → full pool. Random winner. Correct.
If maxVotes > 0, only high-vote options enter winner pool. *Actually correct — no bug.*

### RAGE:MP API VERIFICATION NOTES

All findings below are UNVERIFIED AGAINST LIVE DOCS (no live wiki access during audit).
Based on RAGE:MP 1.1 behavior as observed in codebase patterns:

1. **`player.health` range 0–200**: Used as 0-100 ped HP + 100 offset for arena health bar.
   Codebase consistently maps `health > 100 ? health - 100 : health` for display.
   UNVERIFIED: RAGE:MP docs should confirm `player.health` setter accepts 0–200.

2. **`player.armour` separate property 0–100**: Storm damage skips `player.armour`.
   `readBodyArmour(p)` reads `p.armour` directly. UNVERIFIED: Whether setting `health`
   to values > 200 saturates or throws.

3. **`mp.players.at(id)` returns undefined for disconnected IDs**: Code handles this with
   `if (!p || !mp.players.exists(p)) return;` guards throughout. Correct defensive pattern.

4. **`mp.vehicles.forEach` callback order**: `hasVehicleNearSpawn` uses `mp.vehicles.forEach`
   with early-exit via `blocked` flag (not a real break). RAGE:MP forEach likely iterates all
   players; no documented early-exit API. Pattern is correct but O(n) per spawn point per round.

5. **`player.spawn(position)`**: Used to teleport dead players to their current position
   (essentially a soft respawn without dimension change). UNVERIFIED: Side effects on
   animation state, weapon state after `spawn()` call.

6. **`player.call(event, args)`**: Used for server→client RPC. All call sites use array args.
   UNVERIFIED: Whether RAGE:MP limits argument count or payload size for `player.call`.

7. **`setInterval(tickZones, 200)` and `setInterval(tickMatches, 1000)`**: Both run on the
   RAGE:MP server thread. No async safety for concurrent ticks verified. RAGE:MP is
   single-threaded JS; intervals are cooperative. UNVERIFIED: Whether RAGE:MP's interval
   implementation guarantees monotonic fire order (tickZones at 200ms vs tickMatches at 1000ms).

---

## Output Action
Write `AUDIT_HOPOUTS_ZONE_SPAWNS.md` to the worktree's arena-server-backup-master directory:
`arena-server-backup-master/AUDIT_HOPOUTS_ZONE_SPAWNS.md`

Content: structured per user spec (Critical → High → Medium → Fairness → RAGE:MP notes →
Runtime test checklist), using the verified findings above. No code modifications.
