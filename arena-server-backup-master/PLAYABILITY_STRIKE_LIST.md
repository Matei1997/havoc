# Practical Playability Strike List

Focus: match feel, reliability, and flow after UI modernization. Prioritized for work without live testing vs. work that needs runtime verification.

---

## 1. Top 8 Playability Issues to Verify or Fix Next

### 1.1 Zone wall uses `zoneRadius` instead of `displayRadius` (smoothness bug)

| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Why it matters** | Storm fill and `isOutside` use interpolated `displayRadius`; the purple wall uses raw `zoneRadius`. Wall can jump in 1s steps while fill shrinks smoothly. Players see inconsistent zone boundary. |
| **Files** | `gamemode/source/client/modules/ArenaZone.module.ts` (lines 223–235: `r1`, `r2`, `glowR1`, `glowR2` use `zoneRadius`) |
| **Fix** | Replace `zoneRadius` with `displayRadius` in wall drawing loop. |
| **Code vs runtime** | Code inspection — clear bug. |

---

### 1.2 Medkit/plate keybind duplication (5/6 in ArenaHud + Keybinding)

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Why it matters** | ArenaHud.tsx has `useEffect` keydown 53/54 that emits `arena:useItem`; Keybinding.module.ts also binds 53/54 to `ARENA_USE_ITEM`. Double-firing or conflicting handlers possible. |
| **Files** | `frontend/.../ArenaHud.tsx` (keydown handler), `gamemode/source/client/modules/Keybinding.module.ts` (lines 91–106) |
| **Fix** | Remove CEF key handler from ArenaHud; Keybinding is the single source. Or remove Keybinding and keep CEF-only. |
| **Code vs runtime** | Code inspection — verify which path actually runs. |

---

### 1.3 Crouch re-apply every frame vs. ADS/shoot reliability

| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Why it matters** | Crouch.module re-applies clipset every frame because GTA overrides it when aiming/moving/shooting. If timing is off, player can pop up during ADS or fire. |
| **Files** | `gamemode/source/client/modules/Crouch.module.ts` (render loop, lines 110–112) |
| **Code vs runtime** | **Needs runtime testing** — C-walk (crouch + ADS + walk + shoot) must be verified in-game. |

---

### 1.4 Remote crouch sync on stream-in

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Why it matters** | Crouch sync runs in render loop; `entityStreamIn` does not apply crouch for newly streamed players. Teammate can appear standing until they toggle. |
| **Files** | `gamemode/source/client/modules/Crouch.module.ts` (no streamIn handler for crouch) |
| **Fix** | Add `entityStreamIn` handler: if `p.getVariable("isCrouched") === true`, apply clipset. |
| **Code vs runtime** | Code inspection — likely fix. Runtime to confirm. |

---

### 1.5 Spectate teammate switch feedback

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Why it matters** | LEFT/RIGHT switch targets; CEF gets `spectateTargetChanged`. HUD shows "SPECTATING: Name" and "← → to switch". If CEF/arena store wiring is wrong, label can be stale. |
| **Files** | `ArenaSpectateController.module.ts`, `Spectate.class.ts`, `ArenaHud.tsx`, `Arena.store.ts` (spectatingTarget, spectatingTeammateCount) |
| **Code vs runtime** | **Needs runtime testing** — verify label updates on switch and hint is visible. |

---

### 1.6 Queue → ready check → match start flow

| Field | Value |
|-------|-------|
| **Priority** | P1 |
| **Why it matters** | Core loop: queue → match found → ready check (10s) → accept/decline → voting → match start. Any break (wrong page, missing event, stale state) blocks play. |
| **Files** | `MainMenu.event.ts`, `Arena.event.ts`, `Match.store.ts`, `ReadyCheck.tsx`, `Voting.tsx`, `Lobby.tsx`, `Browser.class.ts` (page transitions) |
| **Code vs runtime** | **Needs runtime testing** — full flow only verifiable in-game. |

---

### 1.7 Item cast cancel on damage

| Field | Value |
|-------|-------|
| **Priority** | P2 |
| **Why it matters** | GAMEPLAY_VERIFICATION_CHECKLIST expects "Taking damage during cast → cast cancels". If server doesn't cancel, players heal through shots. |
| **Files** | `gamemode/source/server/modes/hopouts/ArenaMatch.manager.ts` or item-use handler; `Arena.event.ts` |
| **Code vs runtime** | Code inspection to confirm cancel logic; runtime to verify. |

---

### 1.8 Out-of-bounds / zone HUD clarity

| Field | Value |
|-------|-------|
| **Priority** | P3 |
| **Why it matters** | ZoneInfo shows phase + timer; OOB shows "RETURN TO PLAYABLE AREA • Ns". If placement, contrast, or timing is off, players miss critical info. |
| **Files** | `arenaHud.module.scss` (`.zoneInfo`, `.outOfBounds`), `ZoneInfo.tsx`, `ArenaHud.tsx` |
| **Code vs runtime** | **Needs runtime testing** — readability in combat is subjective. |

---

## 2. Best Next 3 Things to Work On (Without Wasting Time)

### 2.1 Fix zone wall radius bug (ArenaZone)

**Why:** Single, low-risk change. Wall and fill will both use interpolated radius; zone boundary will feel consistent. No gameplay logic change.

**Action:** In `ArenaZone.module.ts` wall-drawing loop, replace `zoneRadius` with `displayRadius` for `r1`, `r2`, `glowR1`, `glowR2`.

---

### 2.2 Deduplicate medkit/plate keybinds

**Why:** Prevents double-firing or conflicting handlers. One source of truth for 5/6.

**Action:** Inspect whether CEF or Keybinding handles 5/6 in arena. Remove the redundant path. Keybinding is client-side and runs when `arena_hud` is shown; CEF handler may be redundant.

---

### 2.3 Add remote crouch sync on stream-in

**Why:** Teammate who streams in while crouched should appear crouched immediately. Small, localized fix.

**Action:** In `Crouch.module.ts`, add `entityStreamIn` handler: for player entities, if `getVariable("isCrouched") === true`, apply clipset after a short delay (stream-in can race with variable sync).

---

## 3. Best Next 3 Things to Postpone Until Live Testing

### 3.1 Crouch + ADS + shoot (C-walk) reliability

**Why:** Crouch re-apply every frame is a workaround for GTA overriding clipset. Whether it holds during ADS + shoot can only be confirmed in-game. No further code changes without testing.

---

### 3.2 Spectate flow and teammate switching

**Why:** LEFT/RIGHT binding, CEF events, and HUD labels are wired. Actual feel (latency, label update, camera behavior) needs live play.

---

### 3.3 Queue → ready check → match start end-to-end

**Why:** Full flow involves server matchmaking, CEF page switches, and event ordering. Any break is only visible when running a real queue and match.

---

## Quick Reference: Code-Only vs Runtime

| Issue | Code-only? | Runtime? |
|-------|------------|----------|
| Zone wall radius bug | ✓ Fix | Optional verify |
| Medkit/plate keybind dedup | ✓ Fix | Optional verify |
| Remote crouch stream-in | ✓ Fix | Optional verify |
| C-walk reliability | — | ✓ Must test |
| Spectate switch feedback | — | ✓ Must test |
| Queue/ready/match flow | — | ✓ Must test |
| Item cast cancel on damage | ✓ Audit | ✓ Verify |
| OOB/zone HUD clarity | — | ✓ Must test |
