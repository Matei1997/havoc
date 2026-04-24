# Runtime Gameplay Verification Checklist

Systems that need real in-game testing after recent changes. Use this to verify local feel, remote readability, and stability.

---

## 1. Crouch / ADS / C-Walking

| Check | Expected | Fail if |
|-------|----------|---------|
| C toggles crouch | Press C → crouch; press again → stand. Smooth blend (0.5s). | C does nothing, or crouch snaps instantly with no blend. |
| Crouch + ADS | Hold right-click while crouched → stay crouched, aim down sights. | Standing when aiming, or clipset overridden. |
| Crouch + ADS + shoot | Crouch, aim, fire → stay crouched while shooting. | Standing when firing, or character pops up. |
| Crouch + walk | Crouch, hold WASD → move in crouched stance. | Cannot move, or standing when moving. |
| C-walk (crouch + ADS + walk + shoot) | Crouch, aim, walk, shoot → all work together. | Any combo breaks (standing, stuck, jitter). |
| C disabled in menu | On non-hud pages (e.g. mainmenu) → C does nothing. | Crouch works in menus. |
| C disabled in vehicle | In vehicle → crouch resets, C unbound. | Crouch persists or C works in vehicle. |

**Requires 2nd player:** No (solo)

---

## 2. Remote Crouch Sync

| Check | Expected | Fail if |
|-------|----------|---------|
| Other player crouches | You see them crouch (low stance, clipset applied). | They appear standing. |
| Other player stands | You see them stand. | They stay crouched on your screen. |
| Crouch on stream-in | Player streams in while crouched → you see crouch. | They appear standing until they toggle. |
| Player quits while crouched | No crash or stale state. | Crash or error in console. |
| Variable sync | Crouch state updates within ~1–2 seconds. | Long delay or never updates. |

**Requires 2nd player:** Yes

---

## 3. Storm / Zone Movement

| Check | Expected | Fail if |
|-------|----------|---------|
| Zone shrinks smoothly | Purple wall moves inward smoothly over time. | Stepping, stuttering, or 1s jumps. |
| No backward wobble | Wall moves inward only; no visible “forward then back” jitter. | Wall visibly moves outward then in. |
| Phase timer | Zone info shows phase and countdown (e.g. PHASE 1, 45s). | Wrong phase, missing timer, or stuck. |
| Outside zone damage | Outside safe zone → HP drains, storm FX. | No damage or no FX. |
| Storm warning | &lt;12s left in phase → “STORM INCOMING” + sound. | No warning or wrong timing. |

**Requires 2nd player:** No (solo)

---

## 4. Medkit / Armor Plate Use

| Check | Expected | Fail if |
|-------|----------|---------|
| 5 = medkit | Press 5 in arena → cast starts, “Healing...” shown. | Nothing happens, or wrong item. |
| 6 = plate | Press 6 in arena → cast starts, “Applying plate...” shown. | Nothing happens, or wrong item. |
| Cast completes | After cast time (4s medkit, 5s plate) → HP/armor updated. | No heal/armor, or cast never completes. |
| Count decrements | Item bar shows 3→2→1 after each use. | Count wrong or stuck. |
| Disabled when 0 | At 0 → button disabled, press does nothing. | Can use when count is 0. |
| Cancel on damage | Taking damage during cast → cast cancels. | Cast continues through damage. |

**Requires 2nd player:** No (solo; use /bot for damage if needed)

---

## 5. Match Result Screen

| Check | Expected | Fail if |
|-------|----------|---------|
| Victory/Defeat/Draw | Correct result and styling (green/red). | Wrong result or no styling. |
| Scores | Red vs Blue scores correct. | Wrong scores. |
| Team K/D | Each player shows kills/deaths. | Missing or wrong. |
| MVP | Player with most kills shown as MVP. | Wrong or missing. |
| MMR section | Rank tier, old→new MMR, delta (e.g. +24). | Missing, wrong, or no delta. |
| XP gain | +N XP shown when earned. | Missing or wrong. |
| Level up | “LEVEL UP: N” when leveled. | Missing or wrong. |
| Challenges completed | List of completed challenges with labels and +XP. | Missing, wrong, or duplicates. |
| XP breakdown | Match Result, Kills, Headshots, Clutch with amounts. | Missing, wrong, or empty when XP &gt; 0. |

**Requires 2nd player:** No (solo; play match to completion)

---

## 6. Challenge Completion Display

| Check | Expected | Fail if |
|-------|----------|---------|
| Match result shows completions | Completing a challenge in-match → appears on match result. | Not shown. |
| Label + reward | Each shows label (e.g. “Get 10 Kills”) and +150 XP. | Missing label or reward. |
| Only this match | Only challenges completed that match. | Shows old completions. |

**Requires 2nd player:** No (solo; complete a challenge in one match)

---

## 7. Play Again / Return to Menu

| Check | Expected | Fail if |
|-------|----------|---------|
| Play Again | From match result → re-queues with last mode/size. | Wrong mode, no queue, or crash. |
| Return to Menu | From match result → leaves match, back to main menu. | Stuck, wrong page, or crash. |
| Party Play Again | In party, leader clicks Play Again → party re-queues. | Solo queue or party broken. |

**Requires 2nd player:** Party flow needs 2+ (solo for basic flow)

---

## 8. Hopouts Queue / 2v2 Default

| Check | Expected | Fail if |
|-------|----------|---------|
| Default size | Hopouts defaults to 2v2. | Different default. |
| Size options | 2v2, 3v3, 4v4, 5v5 selectable. | Missing or wrong. |
| Queue payload | Queue sends mode=hopouts, size=N. | Wrong payload. |

**Requires 2nd player:** No (solo; queue and cancel or wait)

---

## 9. Rank Display in Lobby

| Check | Expected | Fail if |
|-------|----------|---------|
| Rank on Play screen | When on Play tab with Hopouts → rank tier + MMR shown. | Missing or wrong. |
| Fetch on nav | Switching to Play → fetches rank. | Stale or never loads. |
| Seasonal vs lifetime | Shows seasonal rank when active, else lifetime. | Wrong source. |

**Requires 2nd player:** No (solo)

---

## 10. Active Challenge & Party on Play Screen

| Check | Expected | Fail if |
|-------|----------|---------|
| Active challenge card | One challenge shown with progress (e.g. 3/10) and reward. | Missing, wrong, or no progress. |
| Claim button | When completed, unclaimed → Claim button. | Missing or doesn’t work. |
| Party summary | In party → card with members and leader. | Missing or wrong. |
| Party when solo | No party → no party card. | Card shown when solo. |

**Requires 2nd player:** Party checks need 2+ (solo for active challenge)

---

## Quick Reference: Solo vs Multiplayer

| System | Solo | 2+ Players |
|--------|------|------------|
| Crouch / ADS / c-walk | ✓ | ✓ |
| Remote crouch sync | — | ✓ |
| Storm / zone | ✓ | ✓ |
| Medkit / plate | ✓ | ✓ |
| Match result | ✓ | ✓ |
| Challenge completion | ✓ | ✓ |
| Play Again / Return | ✓ | ✓ |
| Queue / 2v2 default | ✓ | ✓ |
| Rank in lobby | ✓ | ✓ |
| Active challenge | ✓ | ✓ |
| Party summary | — | ✓ |
