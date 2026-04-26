# AUDIT_HOPOUTS_ZONE_SPAWNS.md
## Hopouts Arena — Read-Only Subsystem Audit
**Date:** 2026-04-24  
**Scope:** match lifecycle · spawns · zone/storm · reconnect · phase timing · team presentation  
**Method:** Direct source read (no execution). All findings verified against actual file contents.  
**RAGE:MP API claims:** marked UNVERIFIED where live docs were not consulted.

---

## Files Audited

| File | Lines | Role |
|---|---|---|
| `server/modes/hopouts/ArenaMatch.manager.ts` | 1844 | Core match state machine |
| `server/modes/hopouts/ZoneSystem.ts` | 437 | Storm ring tick, damage, interpolation |
| `server/modes/hopouts/ArenaSpawn.validation.ts` | 95 | Spawn point geometric validation |
| `server/modes/hopouts/ArenaConfig.ts` | ~60 | Phase config, item config, round rules |
| `server/modes/hopouts/Arena.module.ts` | ~900 | Queue, team assignment, lobby |
| `server/modes/hopouts/hopoutsVitalsSync.ts` | 32 | Health/armor sync to client |
| `server/modes/hopouts/HopoutsZones.runtime.ts` | 36 | Circle/polygon point-in-zone |
| `server/modes/hopouts/HopoutsZoneRuntime.runtime.ts` | 63 | Per-player custom zone tracking |
| `server/modes/hopouts/HopoutsZoneRuntimeConfig.asset.ts` | 145 | Per-map zone behavior config |
| `server/modes/hopouts/HopoutsZones.asset.ts` | 168 | Zone persistence and sanitization |
| `server/modules/matches/ReconnectManager.ts` | — | 60s reconnect slot storage |
| `server/modules/matches/SpawnHelpers.ts` | — | Spawn candidate wrapper |
| `server/modules/matches/MatchManager.ts` | — | Match registry by dimension |
| `server/modules/matches/MatchRegistry.ts` | — | Cross-mode match lookup |
| `server/modules/matches/TeamPing.service.ts` | — | Team location callouts |
| `client/modules/ArenaZone.module.ts` | 574 | Client storm ring render + interpolation |
| `client/modules/ArenaVitals.module.ts` | 5 | Stub (vitals pushed server-side) |
| `client/modules/ArenaSpectateController.module.ts` | 90 | Dead-player spectate cycling |
| `server/serverevents/Death.event.ts` | — | Death dispatch (FFA / Arena / freeroam) |
| `server/serverevents/DamageSync.event.ts` | — | Damage pipeline, team-fire block |
| `server/serverevents/Player.event.ts` | — | Quit handler, reconnect dispatch |

---

## 1. Critical Findings

*No findings that guarantee data corruption, authentication bypass, or full match state destruction were identified. The most severe issues are classified HIGH below.*

---

## 2. High Findings

### H1 — Null dereference crash in spawn validation fallback
**File:** [`ArenaSpawn.validation.ts:60`](gamemode/source/server/modes/hopouts/ArenaSpawn.validation.ts)  
**Severity:** High — potential server process crash on malformed preset data

```typescript
// Line 60
const ref = preset.center ?? { x: preset.redSpawn.x, y: preset.redSpawn.y, z: zMed };
```

`preset.center` is typed as required in `IArenaPreset`, but no runtime schema validation is
performed on JSON loaded from disk. If a preset file has a missing `center` field **and** a
missing `redSpawn` field, `preset.center` evaluates to `undefined`, the nullish-coalesce falls
through to the right-hand side, and `preset.redSpawn.x` throws:

```
TypeError: Cannot read properties of undefined (reading 'x')
```

`isHopoutsSpawnGeometricallySafe` has no `try/catch`. In RAGE:MP's server-side Node.js
environment, an uncaught synchronous `TypeError` propagates through the call stack. If not
caught higher up, this terminates the event loop iteration and can crash the server process.

**Impact:** Any operator who uploads a malformed preset (missing center + redSpawn) will trigger
a crash on the first round that attempts spawn validation for that preset.

**Fix direction:** Add a null guard before the fallback, or validate preset shape on load rather
than at use time.

---

### H2 — Stale disconnect grace setTimeout triggers premature round end on next round (1v1 scope)
**File:** [`ArenaMatch.manager.ts:1590–1597`](gamemode/source/server/modes/hopouts/ArenaMatch.manager.ts)  
**Severity:** High — silent wrong round result in 1v1 matches

```typescript
// Lines 1590–1597
if (match.state === "active" && matchPlayer.alive) {
    setTimeout(() => {
        if (!getMatchByDimension(match.dimension)) return;  // guard 1
        if (match.state !== "active") return;               // guard 2
        emitAliveCount(match);
        checkAndEmitLastAlive(match);
        checkRoundEnd(match);
    }, roundPresenceGraceMs);  // 15 000 ms
}
```

**Execution timeline in a 1v1 match:**

| Time | Event |
|---|---|
| T+0s | Player A disconnects during Round N (alive=true) |
| T+3s | Round N ends (roundEndDelay fires) |
| T+6s | Round N+1 warmup completes, `match.state = "active"` |
| T+15s | Stale setTimeout fires |
| Guard 1 | `getMatchByDimension` returns the still-live match object → passes |
| Guard 2 | `match.state === "active"` (Round N+1 IS active) → passes |
| `checkRoundEnd` | `matchPlayer.disconnected = true`, `roundPresenceDeadline` already expired |
| `getAlivePlayers(match, "red")` | returns 0 (disconnected player excluded, deadline past) |
| Result | `completeRound(match, "blue")` fires — Round N+1 ends after ~9s |

Both guards use the captured `match` **object reference** (not a snapshot). The state guard was
designed to block stale calls when the round hasn't advanced, but since Round N+1 is legitimately
active by T+15s, it passes silently.

**Root cause compounded by H3 below:** `beginRound` resets `alive=true` for all players but does
**not** clear `disconnected` or `roundPresenceDeadline`, so the formerly-disconnected player
enters Round N+1 already invisible to `getAlivePlayers`.

**Impact:** In any 1v1 scenario, a single player disconnect will cause Round N+1 to resolve
incorrectly ~9 seconds after it starts, awarding the round to the opponent without combat.
Larger team matches (where other teammates are alive on the disconnected team) are unaffected.

---

### H3 — beginRound does not reset `disconnected`/`roundPresenceDeadline` flags
**File:** [`ArenaMatch.manager.ts:1198–1199`](gamemode/source/server/modes/hopouts/ArenaMatch.manager.ts)  
**Severity:** High — directly enables H2; standalone ghost-player effect in multi-round matches

```typescript
// Lines 1198–1199
match.redTeam.forEach((p) => (p.alive = true));
match.blueTeam.forEach((p) => (p.alive = true));
// missing: p.disconnected = false; p.roundPresenceDeadline = undefined;
```

`beginRound` is the canonical "reset for new round" function. It resets `alive`, distributes
weapons, freezes players, and starts the zone — but it leaves `disconnected` and
`roundPresenceDeadline` from a previous disconnect intact on the `MatchPlayer` object.

**Consequence (standalone):** A player who disconnects in Round N and reconnects before Round N+1
has their flags cleared by `restoreReconnectingPlayer`. But if they do **not** reconnect in time
and `removePlayerFromMatchPermanently` splices them out (60s window), the team shrinks correctly.
The gap is the 15–60s window where they remain on the team with stale flags AND a new round
starts, which is the H2 scenario.

**Fix direction:** Add `p.disconnected = false; p.roundPresenceDeadline = undefined;` inside the
`forEach` loops in `beginRound`, or call a dedicated reset helper.

---

## 3. Medium Findings

### M1 — `stormDamageBank` memory leak on player disconnect
**File:** [`ZoneSystem.ts:62,110`](gamemode/source/server/modes/hopouts/ZoneSystem.ts)

```typescript
const stormDamageBank = new Map<number, number>();  // keyed by player.id (session ID)
```

When a player disconnects during active storm, `handleMatchDisconnect` calls:
- `clearHopoutsZonePresenceForPlayer(player.id)` ✓
- Does **not** call `stormDamageBank.delete(player.id)` ✗

RAGE:MP assigns a new numeric `player.id` per connection. On reconnect, `restoreReconnectingPlayer`
updates `matchPlayer.id = player.id` (new session ID), so the OLD session's bank entry is
permanently orphaned. `stopZone` (match end) clears the bank for all known match player IDs, but
the orphaned old ID is no longer in `match.redTeam`/`match.blueTeam`, so:

```typescript
// ZoneSystem.ts:110
matchPlayerIds.forEach((id) => stormDamageBank.delete(id));
// old player.id is not in matchPlayerIds — orphaned entry survives
```

In high-disconnect-rate matches this accumulates unbounded entries for the lifetime of the server
process (no global `stormDamageBank.clear()` elsewhere).

**Impact:** Memory growth proportional to disconnect frequency. No damage-on-reconnect (new id
has fresh bank). No direct gameplay bug, but a server with hundreds of matches and frequent
disconnects will grow this map indefinitely.

---

### M2 — `outOfBoundsStart.clear()` is global when match lookup fails
**File:** [`ZoneSystem.ts:111–113`](gamemode/source/server/modes/hopouts/ZoneSystem.ts)

```typescript
// Lines 107–113
for (const [playerId] of outOfBoundsStart) {
    if (matchPlayerIds.has(playerId)) outOfBoundsStart.delete(playerId);
}
} else {
    outOfBoundsStart.clear();   // ← clears ALL entries from all dimensions
}
```

`outOfBoundsStart` is a module-level `Map<number, number>` (playerId → timestamp). When
`getMatchByDimension(dimension)` returns null inside `stopZone`, the `else` branch executes a
full `.clear()`. This wipes OOB tracking for players in **every active concurrent match**, not
just the one being stopped.

**Trigger path:** `stopZone` is called from `endMatch`, `completeRound`, and `leaveMatch`. If
the match unregisters from `MatchManager` before `stopZone` completes, `getMatchByDimension`
returns null mid-call and the global clear fires. This is a timing-sensitive path.

**Impact:** Players in other concurrent matches who are out of bounds lose their OOB start
timestamp, suppressing the "outOfBounds" UI notification until they re-enter and exit the storm
again. Minor UX disruption; no damage impact (storm damage is separate from OOB tracking).

---

### M3 — Reconnect restores full per-round item counts regardless of prior usage
**File:** [`ArenaMatch.manager.ts:1469–1470`](gamemode/source/server/modes/hopouts/ArenaMatch.manager.ts)

```typescript
const medkits = ITEM_CONFIG.medkit.countPerRound;  // always 3 — ignores pre-disconnect usage
const plates  = ITEM_CONFIG.plate.countPerRound;   // always 3
```

A player who uses 2 medkits (1 remaining), disconnects, and reconnects within the 60s window
receives 3 medkits on restore. `matchPlayer` carries no `usedMedkits`/`usedPlates` counters.

**Exploit path:** A player who used all items, takes a brief disconnect, and reconnects
immediately refreshes their full consumable stock. The 60s reconnect window makes this
intentionally abusable with a soft disconnect (router reset, etc.).

**Impact:** Fairness violation in close rounds. High-skill players unlikely to deliberately
exploit this, but it's an unintended advantage. Storing `medkitsUsed`/`platesUsed` on
`MatchPlayer` and restoring `max(0, perRound - used)` would close the gap.

---

### M4 — Reconnecting player gets stale initial zone radius 200
**File:** [`ArenaMatch.manager.ts:1507`](gamemode/source/server/modes/hopouts/ArenaMatch.manager.ts)

```typescript
player.call(ClientEvents.ARENA_ZONE_INIT, [cx, cy, 200]);  // hardcoded 200
```

`ARENA_ZONE_INIT` is sent to every reconnecting player regardless of the current zone state.
If the zone is on Phase 3 (radius 70), the client minimap ring renders at 200 for up to 200ms
until the next `ARENA_ZONE_UPDATE` tick corrects it. The ring visually snaps from wrong to
correct size.

**Fix direction:** Read `getZoneState(match.dimension)?.currentRadius` and pass the real radius,
or skip `ARENA_ZONE_INIT` entirely for reconnects and let the next tick establish state.

---

### M5 — Custom zone polygon winding order not validated
**File:** [`HopoutsZones.runtime.ts`](gamemode/source/server/modes/hopouts/HopoutsZones.runtime.ts)

The ray-casting point-in-polygon algorithm is correct for consistently-wound polygons (CW or CCW).
No validation is enforced during zone upload (`HopoutsZones.asset.ts sanitizeLegacyZone` checks
point count but not winding order). A zone authored with reversed vertex order will return
`true` for points **outside** the polygon and `false` for points **inside**.

**Impact:** Inverted zone classification silently produces wrong presence tracking
(`arenaInCustomZone`, `arenaCustomZoneCount`). In `block_items_inside` mode, medkits/plates
would be blocked in the wrong area. Admin-facing configuration path; no player input involved.

---

### M6 — Peer-Z spawn consensus skipped with fewer than 3 spawn points per team
**File:** [`ArenaSpawn.validation.ts:74–78`](gamemode/source/server/modes/hopouts/ArenaSpawn.validation.ts)

```typescript
export function filterSpawnPointsWithPeerZConsensus(teamPoints: IArenaPresetPoint[]): IArenaPresetPoint[] {
    if (teamPoints.length < 3) return teamPoints;  // bypass for 1–2 points
    ...
}
```

Presets with only 1 or 2 authored spawn points per team bypass the peer-Z outlier filter
entirely. `isHopoutsSpawnGeometricallySafe` still runs (geometric checks), but the inter-point
consensus that catches "one roof marker among ground spawns" does not trigger. A single bad
authored point is not rejected by its peers.

**Impact:** Presets with minimal authored points (e.g., legacy single-spawn maps) may spawn
players in roof or pool locations that geometric checks alone fail to reject (borderline cases
within the z-band tolerances).

---

## 4. Fairness / Integrity Findings

### F1 — Storm damage bypasses armor entirely *(design choice, verified)*
**File:** [`ZoneSystem.ts:225–249`](gamemode/source/server/modes/hopouts/ZoneSystem.ts)

Storm DPS is subtracted from `player.health` only. `player.armour` is read for the vitals sync
call but is not consumed. A player with 100 armor and 1 HP dies on the next storm tick; a player
with 0 armor and 100 HP survives for many ticks. This asymmetry is consistent with BR genre
norms (ring ignores shields) but is explicitly present in the code and may surprise players
who expect armor to provide storm resistance.

*Marked for awareness — no fix recommended unless design intent changes.*

---

### F2 — Last-alive opponent disconnect: 15s round resolution delay with no player feedback
**File:** [`ArenaMatch.manager.ts:1590`](gamemode/source/server/modes/hopouts/ArenaMatch.manager.ts)

When the last alive opponent disconnects in a 1v1, the remaining player must wait
`roundPresenceGraceSeconds` (15s) before `checkRoundEnd` resolves the round in their favor.
During this window:
- Storm continues ticking (remaining player can die to storm and lose the round they "won")
- No UI notification that the opponent disconnected vs. is alive elsewhere
- `emitAliveCount` fires immediately on disconnect (alive count drops), creating a confusing
  state where the HUD shows 0 enemies alive but the round hasn't ended

**Impact:** UX degradation and potential unfair storm death during artificial hold. Adding a
"Opponent disconnected — resolving…" HUD event would mitigate player confusion.

---

### F3 — Simultaneous death draw extends match without score progress
**File:** [`ArenaMatch.manager.ts:1319–1325`](gamemode/source/server/modes/hopouts/ArenaMatch.manager.ts)

```typescript
if (redAlive === 0 && blueAlive === 0) {
    roundWinner = "draw";
}
```

When both teams reach 0 alive in the same `checkRoundEnd` call (e.g., mutual storm death on
the same 200ms tick), the round is a draw: no score is incremented, and the round counter
advances. In a best-of-7 match, multiple draws can extend a match to 13+ rounds.

**Assessment:** Behavior is correct and symmetric. Draw rounds from mutual storm death are
rare in practice. No fix recommended, but it should be noted in operator/player-facing docs.

---

### F4 — Disconnect-abuse can delay opponent's round win by 15s while storm is active
*(Combines F2 and the H2 context for integrity completeness)*

In a 1v1 final, a losing player can intentionally disconnect to:
1. Force a 15s delay before the opponent's win is registered
2. If opponent is near the storm edge, give storm 15s to potentially kill the opponent
   (storm DPS continues; opponent cannot die to a disconnected player but CAN die to zone)
3. Reconnect within 60s to resume the match

This is a griefing vector in 1v1 brackets. The 15s grace is a legitimate reconnect affordance
but doubles as a stall mechanism.

---

### F5 — Spawn pair rotation: identical spawn used every round in single-pair fallback
**File:** [`ArenaMatch.manager.ts:330–348`](gamemode/source/server/modes/hopouts/ArenaMatch.manager.ts)

When the top-88%-distance filter + vehicle-block filter removes all but 1 spawn pair candidate,
`cyclePool = [defaultPair]` (1 entry). Every round uses the same spawn positions — no rotation.
The `lastSpawnPairKey` guard has no effect with a pool of 1.

**Impact:** On presets with limited authored spawns or dense vehicle coverage, both teams
always spawn in the same positions, creating positional meta-knowledge that favors campers.
This is a preset-quality problem as much as a code problem, but the code provides no warning
when it degrades to single-pair mode.

---

### F6 — Reconnect item refresh is a structural fairness gap
*(Cross-reference M3 for mechanism)*

Beyond the exploit angle, reconnect item refresh produces a structural unfairness between
teams: the team that experienced a disconnect receives effective "free item refills" while the
opposing team consumed items normally. In a tightly contested round, a reconnecting player with
refreshed medkits/plates has a material combat advantage over opponents who used theirs.

---

## 5. RAGE:MP API / Documentation Verification Notes

All claims below are **UNVERIFIED AGAINST LIVE DOCS** — live wiki was not accessible during this
audit. The following should be validated against the current RAGE:MP 1.1 API reference.

| API Usage | Code Location | Claim | Verification Status |
|---|---|---|---|
| `player.health` accepts 0–200 | `hopoutsVitalsSync.ts` | Arena uses 100–200 range for full HP + armor stacking. Setter is assigned values up to 200. | **UNVERIFIED** |
| `player.health = 0` kills ped | `ArenaMatch.manager.ts:1491` | Reconnecting-dead player spawned with `health=0` to trigger death state. | **UNVERIFIED** |
| `player.armour` is separate property (0–100) | `ZoneSystem.ts:247` | Read via `p.armour`; storm skips it. | **UNVERIFIED** |
| `mp.players.at(id)` returns `undefined` for disconnected IDs | All tick loops | Every call site guards `!p \|\| !mp.players.exists(p)`. Pattern appears correct. | **UNVERIFIED** |
| `player.spawn(position)` side effects | `ArenaMatch.manager.ts:1371` | Called on dead victim to soft-teleport in place. Weapon/animation state after `spawn()` not confirmed. | **UNVERIFIED** |
| `player.call(event, args[])` argument limit | `ZoneSystem.ts:385–409` | `ARENA_ZONE_UPDATE` passes 23 positional args per call. If RAGE:MP imposes an argument count limit, this call would silently drop args. | **UNVERIFIED — HIGH PRIORITY** |
| `setInterval` tick ordering | `ZoneSystem.ts:436`, `ArenaMatch.manager.ts:1844` | Two intervals (200ms zone, 1000ms match) share the same JS event loop. Ordering between overlapping ticks not guaranteed by documented API. | **UNVERIFIED** |
| `mp.vehicles.forEach` early-exit pattern | `ArenaSpawn.validation.ts:84` | No native break in RAGE:MP `forEach`. Code uses a `blocked` flag as a soft-break. Iterates all vehicles even after match found. | **VERIFIED AS CORRECT (O(n) cost)** |
| `player.call("client::arena:stormIncoming")` without args | `ZoneSystem.ts:274,317` | Called with no argument array. RAGE:MP `player.call` should accept zero-arg calls. | **UNVERIFIED** |
| Dimension 0 = freeroam assumption | `Player.event.ts` | Disconnect handler: if player dimension ≠ 0, reset position to Legion spawn. Assumes dimension 0 is freeroam exclusively. | **UNVERIFIED** |

---

## 6. Runtime Test Checklist (Hopouts Only)

Use this checklist against a live or staging server. Each test should be run with server console
open to catch uncaught TypeErrors.

### Match Lifecycle
- [ ] **Queue fill → match launch:** Fill queue to required size; verify match dimension allocated,
  both teams teleported, warmup freeze applied, zone initialized at radius 200.
- [ ] **Warmup → active transition:** 3s after spawn, verify players unfreeze, zone begins wait
  phase, storm DPS = 0 during warmup.
- [ ] **Round end → next round:** Kill all players on one team; verify 3s delay, correct score
  increment, spawn reset, weapons redistributed, zone restarted.
- [ ] **Match win condition:** Drive one team to 7 round wins; verify `endMatch` fires, stats
  written, all players returned to main menu after 5s delay.
- [ ] **Max round time (10min) expiry:** Let a round reach 600s without all players dying;
  verify `tickMatches` fires `completeRound` at timeout, no hang.

### Spawn Validation
- [ ] **Vehicle block:** Park a vehicle on a spawn point before round start; verify that spawn
  is excluded from selection (`hasVehicleNearSpawn` returns true).
- [ ] **Fallback to default pair:** Manually reduce preset to 1 authored spawn per team; verify
  server logs single-pair fallback, players still spawn (not in ocean/roof).
- [ ] **Malformed preset (H1):** Upload a preset JSON with `center: null` and `redSpawn: null`;
  verify server does NOT crash — current code will throw, this test confirms the bug.
- [ ] **Peer-Z consensus with 2 points (M6):** Author 2 spawns per team where 1 is on a roof;
  verify the roof spawn is or is not rejected (current: NOT rejected — documents known gap).

### Zone / Storm
- [ ] **Phase progression:** Run full match and verify all 5 zone phases advance
  (wait 34s → shrink 32s → wait 27s → ...). Confirm radius decrements and DPS values on each
  phase match ArenaConfig.
- [ ] **Storm damage banks correctly:** Step into storm; confirm health decreases at expected
  DPS rate (Phase 1: 2 HP/s). With DPS=2 and TICK=200ms, first whole-HP reduction should
  occur at T+500ms (bank accumulates 0.4/tick × 3 ticks ≥ 1.0).
- [ ] **Storm ignores armor:** Equip full armor, step into storm at 1 HP; confirm death on
  next tick (not protected by armor).
- [ ] **Safe-zone entry resets bank:** Enter storm, take partial damage, return to safe zone;
  re-enter storm and confirm banked damage was cleared (no "catch-up" burst on re-entry).
- [ ] **Endgame relocation:** Let match reach post-phase-5; verify zone center relocates every
  30s with 14s smooth drift. Minimap ring should glide, not snap.
- [ ] **Zone death → no killer credit:** Die to storm; verify kill feed shows no killer, no
  roundKills increment on any player.
- [ ] **Simultaneous storm deaths (F3):** Engineer two players to die to storm on the same tick;
  verify round is scored "draw", score unchanged, round counter advances.

### Reconnect / Disconnect
- [ ] **Normal reconnect within 60s:** Disconnect and reconnect within window; verify match
  dimension restored, team outfit reapplied, weapons restored, zone state synced.
- [ ] **Reconnect after round ends:** Disconnect during Round N, let Round N end, reconnect
  during Round N+1; verify player spawns alive in N+1 with correct weapons.
- [ ] **Reconnect timeout (60s):** Disconnect and wait >60s; verify `removePlayerFromMatchPermanently`
  fires, player slot removed, opponent not stuck waiting for them.
- [ ] **H2 reproduction (1v1):** In a 1v1 match, disconnect Player A during Round N while alive.
  Let Round N end naturally, Round N+1 start, wait 15s. Verify Round N+1 does NOT end
  prematurely due to stale grace timeout. *(Currently expected to FAIL — bug confirmed.)*
- [ ] **Item refresh on reconnect (M3):** Use all 3 medkits, disconnect, reconnect within 60s;
  verify medkit count is 3 (bug) or preserved (expected behavior after fix).
- [ ] **Disconnect during warmup:** Disconnect before warmup ends; verify player is excluded
  from round without crashing, 60s reconnect window starts.
- [ ] **Both players disconnect simultaneously:** Both players in a 1v1 disconnect at the same
  time; verify match cleans up (no orphaned dimension) and neither player is stuck.

### Phase Timing
- [ ] **Warmup zone offset:** Verify zone `subPhaseStartedAt = Date.now() - warmupDuration * 1000`
  so that when active state begins, the first wait phase has exactly `waitDuration - warmupDuration`
  seconds remaining (31s for phase 0).
- [ ] **Weapon vote timing:** Trigger weapon vote (every 2 rounds); verify 8s countdown, resolve
  to most-voted weapon, next round starts with that weapon set.
- [ ] **Weapon vote with zero votes:** Let 8s expire with no votes cast; verify random winner
  selected from all options (not a crash or empty resolve).

### Team Presentation / Clothing
- [ ] **Team colors applied on spawn:** Verify red team wears red armor/tops/pants, blue team
  wears blue, at round start and on each subsequent round.
- [ ] **Outfit preserved on leave:** Player outfit before entering queue should be restored on
  `leaveMatch` or `handleMatchDisconnect`.
- [ ] **150ms re-apply covers streaming delay:** Immediately after spawn, outfit may visually
  reset to default for one server frame; verify the 150ms re-apply (line 1248) corrects it.
- [ ] **Reconnect outfit re-applied:** Reconnecting player receives team outfit via
  `applyTeamPresentation`, not original clothes.

### Edge Cases
- [ ] **Zero survivors before match starts:** Verify `checkRoundEnd` does not fire during
  "warmup" state (guard: `if (match.state !== "active") return`).
- [ ] **leaveMatch during round_end state:** Player clicks "leave" during the 3s inter-round
  delay; verify clean exit, no orphaned dimension or stuck team.
- [ ] **All players leave mid-match:** Last player leaves; verify `matchUnregister` fires,
  dimension freed, zone stopped, no interval keeping the match alive.
- [ ] **Team ping during spectate:** Dead player sends a team ping; verify ping is delivered
  only to alive teammates, not enemies.
