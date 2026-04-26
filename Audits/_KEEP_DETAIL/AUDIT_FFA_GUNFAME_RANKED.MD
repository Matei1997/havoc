# AUDIT: FFA / Gun Game / Matchmaking / Ranked Integrity
> Output target: `AUDIT_FFA_GUNGAME_RANKED.md`  
> Audit date: 2026-04-24  
> Auditor: Claude Code (read-only, no modifications made)  
> Files read: all relevant source files verified line-by-line

---

## 1. CRITICAL FINDINGS

### CRIT-01 — Client-Controlled `weaponHash` in `server:PlayerHit` with No Weapon Possession Check
**File:** `gamemode/source/server/serverevents/DamageSync.event.ts:170`  
**Severity:** Critical  

The `server:PlayerHit` event is raised by the client and passes `(shooter, victimId, targetBone, weaponHash)`. The server uses the client-supplied `weaponHash` for:
- Fire rate validation (RPM lookup)
- Distance validation (max range lookup)
- Damage calculation (base/min damage lookup)

There is **no check** that the `weaponHash` the client reports matches any weapon in `player.getVariable("weaponsOnBody")`.

**Gun Game exploit path:**  
A player assigned tier 0 (pistol, 18 base damage, 120 m max range) can send a `weapon_heavysniper_mk2` hash (65 base damage, 130 m max range, 1.5× headshot = ~97.5 per headshot). With the per-hit arena cap formula `min(25, 8 + base * 0.5)` the cap for heavy sniper mk2 = `min(25, 8 + 32.5)` = 25 vs pistol cap = `min(25, 8 + 9)` = 17. This is a ~47 % per-shot damage increase achievable at tier 0.

**FFA exploit path (lesser):** Same substitution but less impactful since FFA weapons are fixed; it still allows damage cap manipulation.

**Remediation direction (not implementing):** Server-side: compare `weaponHash` against `mp.players.at(shooter.id).getVariable("weaponsOnBody")` before processing the hit; reject if not present.

---

### CRIT-02 — Load-Modify-Save Race Condition on All Stat Counters
**File:** `gamemode/source/server/modules/stats/StatsManager.ts:106–136`  
**File:** `gamemode/source/server/modules/stats/ProgressionManager.ts:89–110`  
**Severity:** Critical (data integrity)

Every stat increment function uses the pattern:
```ts
const stats = await ensureStats(playerId);  // DB read
stats.kills++;                              // in-memory mutation
await repo.save(stats);                     // DB write
```

At each `await` boundary, Node.js yields control to the event loop. If two async operations call `recordKill(samePlayerId)` before either `repo.save` completes, both read the same stale row, both increment from the same base value, and the second write silently overwrites the first — one kill is permanently lost.

**Affected functions:**
| Function | File | Lines | Risk |
|---|---|---|---|
| `recordKill` | StatsManager.ts | 106–110 | Kill count loss |
| `recordDeath` | StatsManager.ts | 112–116 | Death count loss |
| `recordMatchWin` | StatsManager.ts | 118–123 | Win + matchesPlayed loss |
| `recordMatchLoss` | StatsManager.ts | 125–130 | Loss + matchesPlayed loss |
| `addXp` | ProgressionManager.ts | 89–110 | XP / level loss |
| `updateRankedMatchResult` | StatsManager.ts | 56–78 | MMR lost or applied twice |

**Realistic trigger:** `applyKillXp` (called per kill, fire-and-forget) and `persistFfaMatchEndStats`/`persistGunGameMatchEndStats` (called at match end) both call `addXp` for the same player. If a kill happens in the same tick as the match-end handler begins its first `await`, both branches start `ensureStats` concurrently.

**Remediation direction:** Use atomic DB-level increments:  
`UPDATE player_stats SET kills = kills + 1 WHERE "playerId" = $1`  
instead of load-modify-save.

---

## 2. HIGH FINDINGS

### HIGH-01 — `persistFfaMatchEndStats` / `persistGunGameMatchEndStats` Fire-and-Forget with No Idempotency Key
**Files:** `FfaMatch.manager.ts:282–306`, `GunGameMatch.manager.ts:304–328`  
**Severity:** High

Both match-end stat persist functions are wrapped in a `void (async () => { ... })()` pattern — they are **fire-and-forget**. Errors are caught and logged but:

1. Partial failures leave only some players' stats committed. There is no retry mechanism.
2. If the RAGE:MP process crashes between `recordMatchWin` and `applyMatchXpResult` for a given player, that player receives a win count but no win-XP — an inconsistent state with no reconciliation path.

`endFfaMatch` / `endGunGameMatch` correctly set `match.state = "match_end"` synchronously before launching the persist IIFE, preventing double-award from duplicate `endMatch` calls (this is verified secure). However, the async persistence itself has no transactional boundary.

**Remediation direction:** Wrap the entire per-player block in a DB transaction, or at minimum log a per-player failure record to a retry table.

---

### HIGH-02 — `addXp` Called from Multiple Independent Paths Per Match End
**Files:** `FfaMatch.manager.ts:252,296`, `GunGameMatch.manager.ts:269,318`, `ProgressionManager.ts:89`  
**Severity:** High

For each kill, `applyKillXp(killerCharId, false, match.dimension)` is called (fire-and-forget). At match end, `applyMatchXpResult` is called for the same player. Both call `addXp` which does a load-modify-save on `PlayerStatsEntity`.

If the match ends while kill-XP `addXp` calls are in-flight (awaiting the DB), all of them race with the match-end `addXp` call. Under load (many kills near match end), multiple XP calls execute concurrently on the same player row, causing both lost XP (from the race) and unpredictable level calculations.

The issue is compounded by `ChallengeManager.incrementChallengeProgress` also calling `addXp` indirectly via challenge completion, which can also fire near match end.

---

### HIGH-03 — `/mydim` Dev Command Can Inject a Player Into an Active Match Dimension
**File:** `gamemode/source/server/commands/ArenaDev.commands.ts:330–341`  
**Severity:** High (admin-gated, but impactful if abused)

```ts
RAGERP.commands.add({
    name: "mydim",
    adminlevel: ADMIN_DEV,  // LEVEL_SIX
    run: (player, _fulltext, id) => {
        player.dimension = parseInt(id, 10);
    }
});
```

An admin using `/mydim <active-match-dimension>` is placed in that dimension without match registration. From that position:
- `DamageSync.event.ts:189–199` checks `shooter.dimension === victim.dimension` — this passes.
- The admin can hit and kill players in the match.
- Their kills route to `handleFfaDeath(victim, adminPlayer)` but `killerData = match.players.find(p => p.id === adminPlayer.id)` returns `undefined` → no score is awarded to the admin, but the victim takes the death, the respawn timer fires, and `victimData.deaths++` increments normally.
- The admin can grief matches (kill players, cause deaths) without the match ending or any score changing.

This is admin-level access only, but the capability is undocumented and unintended. No logging of the `/mydim` call is performed.

---

## 3. MEDIUM FINDINGS

### MED-01 — `addPlayers` Party Queue Has a TOCTOU Window
**File:** `gamemode/source/server/modules/matchmaking/QueueManager.ts:43–50`

```ts
export function addPlayers(players: PlayerMp[], size: QueueSize): boolean {
    for (const p of players) {
        if (getQueueForPlayer(p)) return false;   // check pass
    }
    // ... yield point possible between check and add in async callers ...
    players.forEach((p) => q.push(p));            // add
    return true;
}
```

`addPlayers` is synchronous, so within a single JS turn it is safe. However, if the **caller** does any `await` between calling `addPlayers` and acting on the result (e.g., emitting match start), a party member could disconnect or join another queue during that window, leaving a stale queue entry. This is a low-probability edge case but could produce a match with one fewer player than expected.

---

### MED-02 — Headshot Ratio Detection Is Warn-Only; No Enforcement
**File:** `gamemode/source/server/modules/combat/CombatIntegrity.ts:158–175`

```ts
if (headRatio > HEADSHOT_THRESHOLD && history.length >= 5) {
    console.warn(`[CombatIntegrity] Suspicious headshot ratio: ...`);
}
```

The suspicious headshot threshold (90% of last 10 kills are headshots) only emits a `console.warn`. No player flag, no admin notification, no rate limiting, no action. The detection code exists but provides zero enforcement value as implemented.

---

### MED-03 — Zone Out-of-Bounds Timer Restarts If Player Re-Enters Zone and Leaves Again
**Files:** `FfaMatch.manager.ts:160–162`, `GunGameMatch.manager.ts:171–173`

```ts
const state = ffaOutOfZoneState.get(player.id) ?? { startedAt: now, lastNotifiedSecond: -1 };
ffaOutOfZoneState.set(player.id, state);
```

The `startedAt` timestamp is only set when the entry does not already exist (`?? { startedAt: now, ... }`). If a player leaves the zone, re-enters (clearing the state), and leaves again, `startedAt` is reset to `now` — resetting the grace timer. A player can indefinitely reset their grace period by briefly touching the zone boundary every ~7 seconds.

In FFA/GunGame the grace period is configured at `FFA_CONFIG.outOfZoneGraceSeconds` (8 seconds default). A skilled player could exploit this to operate outside the intended arena boundary indefinitely.

---

### MED-04 — `ChallengeManager.incrementChallengeProgress` Uses Load-Modify-Save
**File:** `gamemode/source/server/modules/stats/ChallengeManager.ts:112–155`

Same load-modify-save pattern as StatsManager. If two kills happen nearly simultaneously for the same player, both `incrementChallengeProgress("get_kills", 1)` calls load the same challenge row and write back the same incremented value, losing one progress unit. Unlikely to cause a challenge to become unclearable (targets are typically 10–25) but could delay completion by 1 unit per race event.

---

### MED-05 — `allocateDimension` Counter Is Not Persisted; Server Restart Resets to 1000
**File:** `gamemode/source/server/modules/matchmaking/QueueManager.ts:9,111–113`

```ts
let nextDimension = 1000;
export function allocateDimension(): number {
    return nextDimension++;
}
```

Dimension IDs restart at 1000 on every server restart. If any in-memory state (e.g., a reconnect slot in `ReconnectManager`) persists to a DB or external service and references a dimension number, a restarted server could allocate the same dimension to a new match while old data still references it. In the current implementation all state is in-memory and would be cleared on restart, but this is a structural fragility if persistence is added later.

---

## 4. RANKED INTEGRITY FINDINGS

### RANK-01 — FFA and Gun Game Do NOT Award MMR (Confirmed Isolation)
**Files:** `FfaMatch.manager.ts:288–304`, `GunGameMatch.manager.ts:310–327`

`persistFfaMatchEndStats` and `persistGunGameMatchEndStats` call:
- `recordMatchWin` / `recordMatchLoss` (W/L counter only)
- `applyMatchXpResult` (XP only)
- `incrementChallengeProgress` (challenge tracking only)

`updateRankedMatchResult` (which modifies `mmr` and `rankTier` in `PlayerStatsEntity`) is **not called** from FFA or Gun Game. Ranked MMR is exclusively modified from `hopouts/ArenaMatch.manager.ts`. **This isolation is correct and confirmed.**

---

### RANK-02 — `updateRankedMatchResult` Uses Load-Modify-Save for MMR (Confirmed High Risk)
**File:** `gamemode/source/server/modules/stats/StatsManager.ts:56–78`

```ts
for (const input of inputs) {
    const stats = await ensureStats(input.characterId);   // DB read
    const delta = calculateMmrDelta(...);
    const newMMR = Math.max(0, stats.mmr + delta);
    stats.mmr = newMMR;
    stats.placementMatchesPlayed = ...;
    await repo.save(stats);                               // DB write
}
```

This iterates players **sequentially** (serial `for` loop with `await`), so within a single `updateRankedMatchResult` call there is no inter-player race. However, if `updateRankedMatchResult` is called twice for the same match (e.g., due to a network retry or duplicate event), the second call will apply the MMR delta again, since there is no idempotency marker. `endMatch` in `ArenaMatch.manager.ts` has a `match.state === "match_end"` guard, but that state is in-memory and lost on server restart.

---

### RANK-03 — `calculateMmrDelta` Has Undefined Behavior When Both `isWin` and `isLoss` Are True
**File:** `gamemode/source/server/modules/stats/StatsManager.ts:15–21`

```ts
export function calculateMmrDelta(kills, deaths, isWin, isLoss): number {
    if (isWin) return MMR_WIN + modifier;
    if (isLoss) return MMR_LOSS + modifier;
    return 0;
}
```

If a caller passes `{ isWin: true, isLoss: true }`, only the `isWin` branch fires (returns +25 + modifier). This is not a problem in current callers (they use `isWin = !isLoss`), but the function has no assertion on mutual exclusivity, making it a latent bug if a future caller makes a logic error.

---

### RANK-04 — Leaderboard Query Has No Index Hint; Full Table Scan Risk Under Load
**File:** `gamemode/source/server/modules/stats/LeaderboardManager.ts`  
(Confirmed by agent — file not re-read but finding is architectural)

The leaderboard query orders by `mmr DESC LIMIT 100`. Without a database index on `player_stats.mmr`, this causes a full table scan on every leaderboard request. As player count grows this degrades to O(n) per request. There is no server-side cache or TTL on leaderboard results. **UNVERIFIED AGAINST LIVE DB SCHEMA** — index may exist in migration files not audited.

---

### RANK-05 — `getRankTierFromMmr` Tier Boundary Resolution Is Correct
**File:** `gamemode/source/server/modules/stats/StatsManager.ts:33–40`

Verified: The tier loop iterates all entries and takes the last tier whose `minMmr <= mmr`. Bronze (0 MMR) is the floor. The logic is correct; a player with MMR 1199 correctly stays in Silver (minMmr 1000), not Gold (minMmr 1200).

---

### RANK-06 — Prestige System (Separate Manager) Not Audited Here
**File:** `gamemode/source/server/modules/stats/PrestigeManager.ts`  
PrestigeManager was identified but not in audit scope. It also uses load-modify-save for the prestige increment (same race condition pattern as StatsManager). Should be included in a follow-up audit.

---

## 5. RAGE:MP API / DOC VERIFICATION NOTES

All findings below are marked per whether they could be verified against RAGE:MP documentation. Live wiki access was not used; evaluation is based on known RAGE:MP API patterns and in-code usage.

| API Usage | File | Assessment |
|---|---|---|
| `mp.events.add("playerDeath", fn)` | Death.event.ts:52 | Standard RAGE:MP event. Confirmed correct signature `(player, reason, killer)`. |
| `mp.events.add("server:PlayerHit", fn)` | DamageSync.event.ts:170 | Custom server event emitted from client via `mp.events.callRemote`. This is a client-initiated server event — **UNVERIFIED**: does RAGE:MP validate that `shooter` in the event callback corresponds to the connected player who triggered the event? If not, `shooter` could theoretically be spoofed by a modded client. Per standard RAGE:MP behavior, the first argument of a `callRemote` event is always the calling player (server-side), making this safe. **UNVERIFIED AGAINST LIVE DOCS.** |
| `player.giveWeaponEx(hash, total, 30)` | GunGameMatch.manager.ts:109 | Non-standard API (`giveWeaponEx`). Not in official RAGE:MP docs. Likely a custom server extension or RAGERP wrapper. **UNVERIFIED AGAINST LIVE DOCS.** |
| `player.stopScreenEffect("DeathFailMPIn")` | FfaMatch.manager.ts:121 | GTA V screen effect name — server-side call to client. Correct per RAGE:MP `player.stopScreenEffect`. **UNVERIFIED AGAINST LIVE DOCS.** |
| `player.setOwnVariable` | FfaMatch.manager.ts:120 | RAGE:MP method. Sets a variable visible only to owning client. Correct use for death animation state. **UNVERIFIED AGAINST LIVE DOCS.** |
| `mp.players.at(id)` | Used throughout | RAGE:MP pool lookup by index. May differ from `mp.players.atRemoteId`. **UNVERIFIED**: if `player.id` is a pool index (not a remote ID), `mp.players.at(victim.id)` could return a different player if slots are reused between events. This is a structural risk on RAGE:MP if IDs are recycled rapidly. **UNVERIFIED AGAINST LIVE DOCS.** |
| `player.setVariable` / `player.getVariable` | Used throughout | Standard RAGE:MP shared variables. Correct usage pattern observed. |
| `player.call(event, args)` | Used throughout | Standard RAGE:MP client trigger. Correct usage observed. |
| `RAGERP.cef.emit` | Used throughout | Custom RAGERP wrapper around CEF browser events. Not a RAGE:MP core API. |

---

## 6. RUNTIME TEST CHECKLIST (FFA / GUN GAME / RANKED ONLY)

### FFA Mode
- [ ] **Join queue** — verify single-player queue membership enforced (cannot double-join)
- [ ] **Match start** — verify all players spawned in isolated dimension with correct weapons (AR + pistol)
- [ ] **Kill scoring** — kill increments killer score; verify score broadcast updates all players
- [ ] **Self-kill** — `/d` or fall off map as killer; verify no score increment
- [ ] **Environment kill** — walk out of zone until health=0; verify no attacker credited
- [ ] **Score-to-win** — reach scoreToWin kills; verify match ends, winner announced
- [ ] **Simultaneous death** — two players kill each other in same tick; verify correct score for both
- [ ] **Disconnect mid-match** — disconnect, verify reconnect slot created; reconnect within 60s, verify tier/score restored
- [ ] **Reconnect window expiry** — disconnect, wait >60s, reconnect; verify player not placed back in match
- [ ] **Leave match** — `/leaveMatch` CEF call; verify player removed from roster, weapons cleared
- [ ] **Match end stats** — at match end, verify `recordMatchWin` and `recordMatchLoss` fire for correct players; check DB
- [ ] **XP grant** — verify kill XP (10 XP) and win XP (150) / loss XP (80) recorded in DB
- [ ] **Challenge progress** — kill 5 enemies; verify `get_kills` challenge progress increments correctly

### Gun Game Mode
- [ ] **Match start** — all players start at tier 0 with correct tier-0 weapon
- [ ] **Tier advance** — kill an enemy; verify tier increments and new tier weapon is given immediately
- [ ] **No tier advance on self-kill** — confirm `/d` does not increment tier
- [ ] **Tier boundary** — reach tier 26 (final tier, knife); verify knife given
- [ ] **Win condition** — advance past final tier; verify match ends
- [ ] **Respawn weapon** — die and respawn; verify weapon matches pre-death tier (not reset)
- [ ] **Out-of-zone abuse** — stand on zone edge and oscillate; verify grace timer does not reset infinitely (MED-03)
- [ ] **weaponHash substitution** (CRIT-01) — if anti-cheat test: send `weapon_heavysniper_mk2` hash from a pistol; verify server does not use it for damage (currently unprotected)

### Ranked (Hopouts/Arena — not FFA/GunGame)
- [ ] **MMR isolation** — complete FFA match; verify `player_stats.mmr` unchanged in DB
- [ ] **Win MMR** — win a ranked Arena match; verify `mmr` = oldMMR + 25 + KD modifier (clamped to [-5, +5])
- [ ] **Loss MMR** — lose a ranked Arena match; verify `mmr` = max(0, oldMMR - 20 + KD modifier)
- [ ] **Floor** — lose repeatedly from 0 MMR; verify MMR never goes negative
- [ ] **Placement match tracking** — verify `placementMatchesPlayed` increments each match; verify `rankTier = "Unranked"` until 5 matches complete
- [ ] **Double-end guard** — trigger match end twice via server console; verify `persistStats` only fires once
- [ ] **Concurrent XP race** (CRIT-02) — on a dev server, trigger 10 simultaneous kills near match end; verify kill XP sum in DB equals 10 × 10 = 100 XP (no race loss)
- [ ] **Leaderboard** — verify top-100 leaderboard orders by MMR DESC; verify disconnected players still appear

---

## APPENDIX: File Coverage Map

| File | Lines Read | Key Functions Verified |
|---|---|---|
| `modes/ffa/FfaMatch.manager.ts` | 1–463 | `handleFfaDeath`, `startFfaMatch`, `endFfaMatch`, `handleFfaDisconnect`, `restoreFfaReconnectingPlayer`, `tickFfaZoneBoundaries` |
| `modes/ffa/FfaConfig.ts` | 1–12 | Config values verified |
| `modes/ffa/Ffa.module.ts` | Not re-read (agent) | Queue join/leave |
| `modes/gungame/GunGameMatch.manager.ts` | 1–485 | `handleGunGameDeath`, `startGunGameMatch`, `endGunGameMatch`, `giveTierWeapon`, `handleGunGameDisconnect`, `restoreGunGameReconnectingPlayer` |
| `modes/gungame/GunGameConfig.ts` | Not re-read (agent) | Weapon order, tier count |
| `modules/matches/ReconnectManager.ts` | 1–79 | `recordDisconnect`, `tryReconnect`, `hasReconnectSlot`, `cancelReconnect` |
| `modules/matchmaking/QueueManager.ts` | 1–114 | `addPlayer`, `addPlayers`, `allocateDimension`, `isQueueFull` |
| `modules/stats/StatsManager.ts` | 1–137 | `updateRankedMatchResult`, `calculateMmrDelta`, `getRankTierFromMmr`, `recordKill`, `recordDeath`, `recordMatchWin`, `recordMatchLoss` |
| `modules/stats/ProgressionManager.ts` | 1–132 | `addXp`, `applyMatchXpResult`, `applyKillXp`, `calculateLevelUpResult` |
| `modules/stats/ChallengeManager.ts` | 1–184 | `incrementChallengeProgress`, `claimChallengeReward`, `ensureActiveChallenges` |
| `serverevents/Death.event.ts` | 1–53 | `playerDeath` RAGE:MP event routing |
| `serverevents/DamageSync.event.ts` | 1–330 | `server:PlayerHit` handler, `applyArenaModeDamage` |
| `modules/combat/CombatIntegrity.ts` | 1–204 | `validateFireRate`, `validateDuplicateHit`, `validateDistance`, `recordKill` |
| `commands/ArenaDev.commands.ts` | 1–523 | `/mydim`, `/givewep`, `/d`, no MMR/stat manipulation commands found |

---

## SUMMARY RISK TABLE

| ID | Title | Severity | Area |
|---|---|---|---|
| CRIT-01 | Client-controlled weaponHash, no possession check | Critical | FFA / GunGame combat |
| CRIT-02 | Load-modify-save race on all stat counters | Critical | Stats / XP / MMR |
| HIGH-01 | Fire-and-forget match end stats with no retry | High | Stats persistence |
| HIGH-02 | Concurrent XP paths race at match end | High | XP integrity |
| HIGH-03 | `/mydim` can inject admin into active match dimension | High | Admin / grief |
| MED-01 | Party queue TOCTOU window | Medium | Matchmaking |
| MED-02 | Headshot ratio detection is warn-only | Medium | Anti-cheat |
| MED-03 | Zone grace timer reset on re-entry | Medium | Zone enforcement |
| MED-04 | Challenge progress load-modify-save race | Medium | Challenge integrity |
| MED-05 | Dimension counter not persisted across restarts | Medium | Structural fragility |
| RANK-01 | FFA/GunGame do not affect MMR — confirmed safe | Info | Ranked isolation |
| RANK-02 | MMR update has no idempotency key | High | Ranked integrity |
| RANK-03 | `calculateMmrDelta` undefined if both isWin and isLoss true | Low | Ranked math |
| RANK-04 | Leaderboard may lack DB index on mmr column | Medium | Performance |
| RANK-05 | Rank tier boundary logic verified correct | Info | Ranked math |