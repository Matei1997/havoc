# Plan: Frontend/CEF/UI/HUD Audit → AUDIT_FRONTEND_CEF_UI.md

## Context
User requested a read-only audit of the frontend/CEF/UI/HUD/page lifecycle subsystem. No code changes. Output is a single structured markdown file: `AUDIT_FRONTEND_CEF_UI.md` at the project root. All findings below have been gathered via static analysis of the listed files.

---

## Findings Summary (used to produce the audit file)

### CRITICAL
| # | Location | Finding |
|---|----------|---------|
| C01 | `frontend/src/pages/hud/Chat/Chat.tsx:182` | **XSS via dangerouslySetInnerHTML** — `el.html` from chat store is unsanitized server HTML. Allows arbitrary script injection via malicious chat message. |
| C02 | `source/client/classes/Browser.class.ts:191` | **Render event never removed** — `mp.events.add("render", this.onTick.bind(this))` registered in constructor, never removed in `emergencyReset()`, `closePage()`, or `playerQuit()`. On emergency reset a new `_Browser` instance is not re-created (singleton), but the handler persists across all resets. |
| C03 | `frontend/src/App.tsx:55–67` | **EventManager handlers never removed** — `stopAddingHandler()` is a debug log only; it does NOT call `removeHandler()`/`removeTargetHandlers()`. The `setPage` and `notify:show` handlers are permanent leaks on any remount. |
| C04 | `frontend/src/stores/*.ts` (all stores) | **Pattern-wide misuse of `stopAddingHandler()`** — All store `createEvents()` methods call `stopAddingHandler()` thinking it cleans up. It does not. Affects: Chat, AdminSpectate, CharCreator, Friends, GunGame, Hud, Nativemenu, Player, PlayerList, Wardrobe stores. |

### HIGH
| # | Location | Finding |
|---|----------|---------|
| H01 | `source/client/classes/Browser.class.ts:416–419` | **CEF injection risk** — Event name and args concatenated into `mainUI.execute()` string via template literal without escaping. Malformed event name allows arbitrary JS injection into the CEF context. |
| H02 | `source/client/classes/Browser.class.ts:341,378` | **Cursor locked to center** — `mp.gui.cursor.show(showCursor, true)` passes `true` for `lockedAtCenter` on every tick. UI clicks break in mouselook mode. |
| H03 | `source/client/classes/Browser.class.ts` render handlers in 35+ modules | **Module render events never removed** — ArenaRadar, ArenaZone, Crouch, HopoutsZoneEditor, Compass, Hitmarker, Keybinding, etc. all call `mp.events.add("render", fn)` at module scope with no cleanup. Fire every frame (60×/sec) for entire session. |
| H04 | `frontend/src/pages/hud/HUD/ArenaHud.tsx:84` | **Hardcoded imgur URL in production code** — `background: "url('https://i.imgur.com/k6lP09r.jpg')"` in debug simulation branch. External dependency, reveals debug state, security hygiene failure. |
| H05 | `frontend/src/pages/hud/TacticalCompass.tsx` | **~4,608 DOM nodes for compass tape** — `Math.floor((360 * 64) / 5)` tick elements rendered as divs instead of SVG/canvas. Frame-rate risk on low-end clients. |
| H06 | `source/client/classes/Hud.class.ts:31,36–40` | **PlayerHud render event not cleaned by `clearIntervals()`** — Three setIntervals are cleared on `playerQuit` but the `mp.events.add("render", ...)` from constructor is not. |

### MEDIUM
| # | Location | Finding |
|---|----------|---------|
| M01 | `frontend/src/stores/Arena.store.ts:312,462,467` | **Orphan timeouts not tracked** — `roundStart` clear timer (line 312), kill notification (462), death notification (467) are created with raw `setTimeout` but never added to cleanup arrays (`_arenaDeathTimeouts`). Fire after arena page unmounts. |
| M02 | `frontend/src/PageContext.tsx:40` | **Function reference instead of call** — `getInitialPageFromSearchParams` used without `()`. Returns the function object, not the page string. Initial page from URL params never applies. |
| M03 | `source/client/classes/Browser.class.ts:462,607–611` | **Blur state not cleared on emergency reset** — `emergencyReset()` resets page state flags but does NOT call `transitionFromBlurred()`. After a crash-reset, world can stay permanently blurred. |
| M04 | `source/client/auth/Auth.event.ts:56` | **Discord OAuth URL not validated** — URL passed directly to `mp.browsers.new(url)` with no same-origin or format check. Server can open arbitrary URLs in CEF. |
| M05 | `source/client/modules/AttachEditor.module.ts:207–211` | **AttachEditor browser never destroyed** — Reused across sessions; unlike Speedometer module, no `destroy()` on close. Memory footprint grows. |
| M06 | `frontend/src/pages/admin/AdminPanel.tsx` | **2,200+ LOC single file** — Sound pool SOUND_SLOTS initialized as `undefined` throughout; `playUiSound()` is silently a no-op. No audio feedback for admin actions. |
| M07 | `frontend/src/pages/hud/Chat/Chat.tsx:58–61` | **Chat stale state risk** — `store` used as effect dependency but `store.isActive` checked inside. Effect re-runs on any store mutation, not just `isActive` changes. |
| M08 | `source/client/classes/Browser.class.ts` | **236 `mp.events.add()` vs. 3 `mp.events.remove()` across client** — Systemic imbalance; event handler lifetime management is near-absent outside of IdleCamera and weapon wheel one-shot. |

### UI/UX Quality (page-by-page)
| Page | Score | Key Issues |
|------|-------|-----------|
| **Auth** | 8.5/10 | Best-in-class GSAP scoping; boot veil 6s hardcoded no spinner; Discord OAuth error → silent pending |
| **HUD / Chat** | 6/10 | XSS critical; opacity race condition on fade; chat feels webby (floating panel); no rate limiting on sends |
| **Arena HUD** | 8/10 | Excellent mode dispatch; scoreboard clean; compass DOM-intensive; imgur debug URL |
| **MainMenu** | 7/10 | Aggressive Escape swallow (capture phase, no guard); no load timeout; emits "scene" on every tab |
| **Admin Panel** | 5/10 | Web-dashboard look; 2,200 LOC monolith; silent sound pool; no keyboard shortcuts; no change indicator on report auto-update |
| **AdminMini** | 7/10 | Clean focused scope; good confirmation dialogs; slight webby feel |
| **Report** | 9/10 | Exemplary; Virtuoso for perf; scoped GSAP; no rate limit on sends; FloatingHint doesn't close on Escape |

### RAGE:MP API Verification Notes
- `mp.browsers.exists()` guards: ✅ Correct — consistently applied before all browser ops
- `mp.game.controls.setDisableControlActionBatch()`: ✅ Correct batch usage
- `mp.gui.chat.show(false)` / `activate(false)`: ✅ Correct — native GTA chat properly disabled
- `markAsChat()`: ✅ Correct — signals RAGE:MP this browser is UI
- `mp.gui.cursor.show(visible, lockedAtCenter)`: ❌ Second param should be `false` for UI cursor; always `true` breaks mouselook click
- `mp.game.graphics.transitionToBlurred()`: ✅ Correct; ⚠️ not guaranteed to complete if page closes mid-transition
- All docs verification performed against static analysis of RAGE:MP known API patterns — **UNVERIFIED AGAINST LIVE RAGE:MP DOCS** (no live wiki access confirmed)

---

## Output Plan

**File to create:** `AUDIT_FRONTEND_CEF_UI.md` at project root

**Structure:**
1. Critical Findings (C01–C04)
2. High Findings (H01–H06)
3. Medium Findings (M01–M08)
4. UI/UX Quality Findings page-by-page
5. RAGE:MP API / doc verification notes
6. Runtime test checklist (frontend/CEF/HUD only)

**Files to NOT modify:** all source files — this is read-only.

---

## Critical Files Referenced
- `frontend/src/App.tsx`
- `frontend/src/PageContext.tsx`
- `frontend/src/pageLifecycle.ts`
- `frontend/src/stores/Arena.store.ts`
- `frontend/src/stores/Chat.store.ts`
- `frontend/src/stores/*.ts` (all stores)
- `frontend/src/pages/hud/Chat/Chat.tsx`
- `frontend/src/pages/hud/HUD/ArenaHud.tsx`
- `frontend/src/pages/hud/TacticalCompass.tsx`
- `frontend/src/pages/mainmenu/MainMenu.tsx`
- `frontend/src/pages/auth/Authentication.tsx`
- `frontend/src/pages/admin/AdminPanel.tsx`
- `frontend/src/pages/report/Report.tsx`
- `source/client/classes/Browser.class.ts`
- `source/client/classes/Hud.class.ts`
- `source/client/auth/Auth.event.ts`
- `source/client/modules/AttachEditor.module.ts`

## Verification (Post-Execution)
- Open AUDIT_FRONTEND_CEF_UI.md and confirm all 6 sections present
- Confirm line references are accurate by spot-checking 3–4 cited locations
- No source files modified (git diff should be clean except the audit file)
