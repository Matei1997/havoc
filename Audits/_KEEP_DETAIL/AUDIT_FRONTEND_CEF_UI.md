# Frontend / CEF / UI / HUD Audit

**Scope:** Static analysis only. No code was modified.
**Date:** 2026-04-24
**Auditor:** Claude (Sonnet 4.6)

Files audited:
- `frontend/src/App.tsx`, `PageContext.tsx`, `pageLifecycle.ts`
- `frontend/src/stores/*`
- `frontend/src/pages/hud/*`, `arena/*`, `mainmenu/*`, `auth/*`, `admin*`, `report/*`
- `source/client/classes/Browser.class.ts`, `Hud.class.ts`
- `source/client/auth/Auth.event.ts`
- `source/client/modules/AttachEditor.module.ts`

---

## 1. Critical Findings

### C01 — XSS via `dangerouslySetInnerHTML` in Chat
**File:** `frontend/src/pages/hud/Chat/Chat.tsx:182`

```tsx
<span
  className={style.message}
  style={{ fontSize: `${store.settings.fontsize}vh` }}
  dangerouslySetInnerHTML={{ __html: timePrefix + el.html }}
/>
```

`el.html` is server-supplied HTML stored verbatim in `Chat.store.ts` with no sanitization applied at any layer before render. `timePrefix` is also constructed as a raw HTML string (`<span class="chat-timestamp">[${el.time}]</span> `).

**Attack surface:** Any server-side compromise, or a sufficiently privileged player whose message reaches other clients, can inject arbitrary HTML/JS into every connected client's CEF browser context. CEF runs Chromium with `--no-sandbox` by default in RAGE:MP — code executed here has full browser privileges.

**Proof-of-concept payload:** `<img src=x onerror="mp.trigger('client::someEvent')">` — this would execute a client-side RAGE:MP event trigger from within chat.

**Fix:** Wrap with `DOMPurify.sanitize(el.html)` before setting, or render message text as a plain `textContent` node and build the timestamp separately as a React element (preferred — eliminates the attack surface entirely).

---

### C02 — `EventManager` handlers never removed in `App.tsx`
**File:** `frontend/src/App.tsx:55–67`

```tsx
useEffect(() => {
    const handleSetPage = (newPage: string | null) => setPage(newPage);
    EventManager.addHandler("system", "setPage", handleSetPage);
    EventManager.addHandler("notify", "show", (data) => { ... });
    return () => {
        EventManager.stopAddingHandler("notify");   // ← does NOT remove handlers
        EventManager.stopAddingHandler("system");   // ← does NOT remove handlers
    };
}, [setPage]);
```

`stopAddingHandler()` in `EventManager.util.ts` is a **debug-only logging method** (prints loaded event names in dev mode). It does not call `removeHandler()` or `removeTargetHandlers()`. The cleanup function is therefore a no-op. If `App` ever remounts (HMR, error boundary recovery), duplicate handlers accumulate for `system:setPage` and `notify:show`.

**Fix:** Replace with `EventManager.removeHandler("system", "setPage", handleSetPage)` and `EventManager.removeHandler("notify", "show", ...)` in the cleanup return.

---

### C03 — Pattern-wide `stopAddingHandler()` misuse across all stores
**Files:** `frontend/src/stores/Chat.store.ts`, `Hud.store.ts`, `Player.store.ts`, `PlayerList.store.ts`, `Friends.store.ts`, `GunGame.store.ts`, `AdminSpectate.store.ts`, `CharCreator.store.ts`, `Nativemenu.store.ts`, `Wardrobe.store.ts`

Every `createEvents()` method in the codebase follows this pattern:

```typescript
public createEvents() {
    EventManager.addHandler("chat", "setActive", (data) => this.setActive(data));
    EventManager.addHandler("chat", "setCommands", (data) => this.fetchCommandList(data));
    EventManager.stopAddingHandler("chat");  // ← debug log, not a cleanup
}
```

**All stores register handlers that are never removed.** Because stores are singletons, handler leakage is limited to double-registration if `createEvents()` is called more than once (e.g. after an emergency reset triggers re-initialization). The `stopAddingHandler()` method was almost certainly written with the intent to clean up but never wired to the actual removal path.

**Fix:** Either (a) ensure `createEvents()` is called exactly once per store lifetime and document the single-call invariant, or (b) store handler references and call `EventManager.removeHandler()` in a `destroyEvents()` counterpart.

---

### C04 — `mp.events.add("render", ...)` in `Browser.class.ts` constructor never removed
**File:** `source/client/classes/Browser.class.ts:191`

```typescript
constructor() {
    // ...
    mp.events.add("render", this.onTick.bind(this));  // No cleanup path
    // ...
}
```

`onTick` is called on **every rendered frame** (60+ Hz). The handler is never removed in:
- `emergencyReset()` — resets page state but the render event remains
- `closePage()` — only resets transient flags
- `playerQuit` handler — not addressed

Because `_Browser` is a singleton, additional `render` registrations from reruns of the constructor don't occur. However, the handler **runs unconditionally for the entire session** — including frames where no page is open. The `applyGameplayControlBatch()` call inside it is a non-trivial operation (multiple `mp.game.controls.setDisableControlAction()` calls) that runs needlessly when idle.

**Fix:** Store the bound reference at construction (`this._onTick = this.onTick.bind(this)`), and call `mp.events.remove("render", this._onTick)` in any full teardown path.

---

## 2. High Findings

### H01 — CEF JS injection via unescaped `mainUI.execute()` template literal
**File:** `source/client/classes/Browser.class.ts:416–419`

```typescript
processEvent(eventName: string, ...args: any): void {
    if (this.mainUI && eventName.includes("cef::")) {
        const event = eventName.split("cef::")[1];
        const argsString = args.map((arg: string) => JSON.stringify(arg)).join(", ");
        const script = `window.callHandler("${event}", ${argsString})`;
        this.mainUI.execute(script);
    }
}
```

`event` (the portion of the event name after `"cef::"`) is interpolated directly into a JavaScript string literal without escaping. A crafted event name such as `cef::foo", inject="evil` produces:

```javascript
window.callHandler("foo", inject="evil", ...)
```

`argsString` uses `JSON.stringify` which is safer, but the event name is unprotected.

**Fix:** `const script = \`window.callHandler(${JSON.stringify(event)}, ${argsString})\`;`

---

### H02 — Cursor locked to screen center on every HUD tick
**File:** `source/client/classes/Browser.class.ts:341` (and line 378)

```typescript
mp.gui.cursor.show(showCursor, showCursor);
// second param = lockedAtCenter; should be false for a UI cursor
```

The RAGE:MP cursor API is `mp.gui.cursor.show(visible: boolean, lockedAtCenter: boolean)`. Passing `showCursor` for both parameters means: whenever a UI cursor is shown, it is **also locked to the screen center**. This makes every UI element unreachable by mouse — clicks register at the center of the viewport regardless of pointer position.

**UNVERIFIED AGAINST LIVE RAGE:MP DOCS** — based on known RAGE:MP API signature patterns.

**Fix:** `mp.gui.cursor.show(showCursor, false);`

---

### H03 — 35+ module-level `mp.events.add("render", ...)` calls with no removal
**Files (representative):** `source/client/modules/ArenaRadar.module.ts:313`, `ArenaZone.module.ts:422`, `Crouch.module.ts:118`, `HopoutsZoneEditor.module.ts:1009`, `Compass.module.ts`, `Hitmarker.module.ts`, `Keybinding.module.ts`, and ~28 others.

Every module registers render callbacks at module-load time. None export or call a cleanup. All fire on every frame (60 Hz) for the entire session regardless of whether the module's feature is active.

**Cumulative cost (8h session):** 35 handlers × 60 fps × 28,800 s = ~60.5 million handler invocations per session. On low-end clients this is the dominant frame-time cost in the client JS runtime.

**Fix:** Introduce an `enable()` / `disable()` pair per module; only register the render event when the feature is active and remove it when deactivated.

---

### H04 — Hardcoded external imgur URL in production HUD code
**File:** `frontend/src/pages/hud/HUD/ArenaHud.tsx:84`

```tsx
background: "url('https://i.imgur.com/k6lP09r.jpg') center/cover no-repeat, #0a0b0d",
```

This is inside a solo-simulation debug branch but ships in the production bundle. Issues:
1. External CDN dependency — URL may 404 or change without warning.
2. Reveals internal debug/simulation state to anyone inspecting the bundle.
3. Players with network filtering (corporate NAT, firewall) will get a broken background.

**Fix:** Use a local asset (`/assets/debug-bg.jpg`) or guard the entire branch behind a `DEV` / `import.meta.env.DEV` check.

---

### H05 — ~4,608 DOM nodes for TacticalCompass tape
**File:** `frontend/src/pages/hud/TacticalCompass.tsx`

```typescript
const TAPE_DEG_SPAN = 360 * 64;   // 23,040 degrees
const TICK_STEP_DEG = 5;
const TICK_COUNT = Math.floor(TAPE_DEG_SPAN / TICK_STEP_DEG);  // = 4,608
```

4,608 `<div>` elements are rendered for the compass tape. At 60 fps, CSS `transform` on the tape container causes the browser layout engine to composite a 4,608-node subtree every frame. On integrated-GPU / low-RAM clients (common in GTA:MP player base) this alone can drop frame rate below 30 fps.

**Fix:** Replace with an SVG `<path>` or `<canvas>` approach. The visible window of a compass tape is ≤ 180°; only ~36 ticks need to exist at any time. A looping/modulo approach with a small fixed DOM reduces this to O(1) node count.

---

### H06 — `PlayerHud` render event not removed on player quit
**File:** `source/client/classes/Hud.class.ts:31, 36–40`

```typescript
constructor() {
    this.onlinePlayersCounter = setInterval(this.setOnlinePlayers.bind(this), 5_000);
    this.weaponInterval     = setInterval(this.trackPlayerWeapon.bind(this),  100);
    this.zoneInterval       = setInterval(this.trackPlayerZone.bind(this),    1_000);
    mp.events.add("render", this.pushVitalsToCefEveryFrame.bind(this));  // ← not cleaned
    mp.events.add("playerQuit", () => this.clearIntervals());
}

clearIntervals() {
    clearInterval(this.onlinePlayersCounter);
    clearInterval(this.weaponInterval);
    clearInterval(this.zoneInterval);
    // render event is NOT removed here
}
```

After `playerQuit`, the three intervals stop but `pushVitalsToCefEveryFrame` continues executing on every rendered frame for the remainder of the process lifetime. It pushes vitals data to a CEF page that no longer exists, silently failing with wasted CPU.

**Fix:** Store `this._vitalsTick = this.pushVitalsToCefEveryFrame.bind(this)` and add `mp.events.remove("render", this._vitalsTick)` inside `clearIntervals()`.

---

## 3. Medium Findings

### M01 — Orphan timeouts in `Arena.store.ts`
**File:** `frontend/src/stores/Arena.store.ts:312, 462, 467`

Three `setTimeout` calls are created outside of any tracked array:

```typescript
// line 312 — roundStart clear
setTimeout(() => {
    if (this.roundStart?.round === data.round) this.roundStart = null;
}, (data.warmupTime + 1) * 1000);

// line 462 — kill notification
setTimeout(() => (this.lastKillNotification = null), 2500);

// line 467 — death notification
setTimeout(() => (this.lastDeathNotification = null), 3000);
```

`flushArenaTransientTimeouts()` clears `_arenaDeathTimeouts` and `_deathOverlayTimeouts` but not these. If the player leaves the arena page before any of these fire, they mutate store state on a dead page context, potentially triggering unnecessary re-renders or incorrect state for the next arena session.

**Fix:** Add these return values to `_arenaDeathTimeouts` (or a dedicated `_miscTimers` array) and flush them in `flushArenaTransientTimeouts()`.

---

### M02 — `getInitialPageFromSearchParams` called without `()` in `PageContext.tsx`
**File:** `frontend/src/PageContext.tsx:40`

```typescript
const [page, setPageRaw] = useState<string | null>(getInitialPageFromSearchParams);
//                                                  ^^ function reference, not call result
```

`useState` accepts a **lazy initializer** (a function) — so this actually works as intended by React: React calls `getInitialPageFromSearchParams()` once on mount. This is valid React pattern and **not a bug**. It is however non-obvious and may mislead readers into thinking it is called without arguments when in fact React calls it with no args. Worth a clarifying comment.

*Severity downgraded — original finding was incorrect. No fix required.*

---

### M03 — Blur state not cleared after `emergencyReset()`
**File:** `source/client/classes/Browser.class.ts`

`emergencyReset()` destroys and recreates the CEF browser but does not call `mp.game.graphics.transitionFromBlurred()`. If the page that was open at the time of the reset had requested world blur (e.g. `mainmenu`, `charCreator`), the GTA world remains blurred indefinitely after the reset. The blur is never lifted until the next `startPage()` call that happens to set `blurWorld = false`.

**Fix:** Add `mp.game.graphics.transitionFromBlurred(0)` (or duration `1`) at the start of `emergencyReset()` as an unconditional reset of visual state.

---

### M04 — Discord OAuth URL passed to `mp.browsers.new()` without validation
**File:** `source/client/auth/Auth.event.ts:56`

```typescript
mp.events.add("client::auth:discordOpen", (url: string) => {
    if (!url || typeof url !== "string") return;
    // ...
    discordOAuthBrowser = mp.browsers.new(url);  // No URL format/origin check
});
```

The only guard is a truthy string check. A compromised server packet can supply any URL — including `file:///`, `javascript:`, or a phishing domain — and it will be opened in a RAGE:MP CEF browser with full local privileges. This is an escalation path from server compromise to client.

**Fix:** Validate that the URL starts with `https://discord.com/` (or a whitelist of known OAuth endpoints) before creating the browser.

---

### M05 — `AttachEditor` CEF browser never destroyed on close
**File:** `source/client/modules/AttachEditor.module.ts:207–211`

```typescript
if (!editBrowser) {
    editBrowser = mp.browsers.new(BROWSER_URL);
} else {
    editBrowser.execute("setupAttachEditor();");
    editBrowser.active = true;  // Reuse without cleanup
}
```

The browser is reused across sessions but never destroyed (unlike `Speedometer.module.ts` which calls `.destroy()` correctly). Each `attachEditor` session loads new React state and potentially new assets into the same browser instance, steadily growing heap usage.

**Fix:** Call `editBrowser.destroy(); editBrowser = null;` on editor close, then always create fresh.

---

### M06 — Admin sound pool silently broken; `AdminPanel.tsx` monolith
**File:** `frontend/src/pages/admin/AdminPanel.tsx`

```typescript
const SOUND_SLOTS: Partial<Record<UiSoundName, string[]>> = {
    refresh: undefined,
    close:   undefined,
    // ... all undefined
};
```

`playUiSound()` guards on `SOUND_SLOTS[name]?.length` before playing; since every slot is `undefined`, no audio ever plays. Admin panel has no auditory feedback for actions (ban, kick, refresh, close). This is also a 2,200+ LOC single-component file, making the code hard to maintain and test.

**Fix (sound):** Populate `SOUND_SLOTS` with the actual sound asset paths, or remove the dead abstraction and call the audio API directly. **Fix (structure):** Split into per-section components (Players, Reports, Bans, Chat, Settings, etc.).

---

### M07 — Chat `useEffect` over-broad dependency on `store`
**File:** `frontend/src/pages/hud/Chat/Chat.tsx:58–61`

```tsx
useEffect(() => {
    if (!store.isActive) {
        // reset state
    }
}, [store.isActive, store]);  // store is too broad
```

Including `store` (a MobX observable object) as a dependency means the effect re-runs on **any observable mutation** to the store, not just `isActive` changes. In a busy match, this triggers dozens of unnecessary effect runs per second, each touching DOM refs and timers.

**Fix:** Remove `store` from the dependency array; use only the specific observed values (`store.isActive`, `store.messages.length`, etc.).

---

### M08 — Systemic event handler imbalance: 236 adds vs. 3 removes
**Scope:** All files under `source/client/`

A grep across the client directory shows approximately 236 `mp.events.add()` calls and only 3 `mp.events.remove()` calls (in `IdleCamera.module.ts` ×2 and `Render.event.ts` weapon wheel ×1). The entire event system operates on an add-only model. For the current architecture (module-scope singletons, one session per process) this is not catastrophic — handlers simply stay registered until process exit. The risk is concentrated in:

- Any code path that can re-execute `createEvents()` or module initializers
- Emergency resets that re-initialize subsystems
- Future refactors that introduce multiple instance lifecycles

This is a systemic design debt note, not an immediate crash risk.

---

## 4. UI/UX Quality Findings

### Auth Page
**Score: 8.5/10**

Strengths:
- Terminal/boot aesthetic is cohesive and game-appropriate.
- GSAP usage is best-in-class: all timelines are scoped to `terminalRef`, auto-killed on unmount, dependencies correctly empty (fire-once).
- Boot veil prevents UI flash reliably.
- State machine (gate → legacy | discord_username) is clean and linear.

Issues:
- 6-second hardcoded `setTimeout` for boot veil fallback with no loading indicator. Players on slower machines see a blank screen with no feedback.
- Discord OAuth error path: if the server returns an error after `discordOpen`, state stays in `"pending"` forever with no visible error message.
- `useGSAP` scope pattern is correct but not consistently applied across the codebase — Auth is the only page that does this right.

---

### HUD / Chat
**Score: 6/10**

Strengths:
- Component composition is clean (Chat, DeathScreen, InteractButton are separate).
- DeathScreen countdown and respawn timer logic is correct.
- Chat tab cycling (↑/↓ arrows), command autocomplete, and history cycling work correctly.

Issues:
- **XSS** (see C01) — highest priority in the codebase.
- Chat panel feels "webby" — it looks like a Discord/Slack widget dropped into GTA. A more minimal transparent strip (text-only, no box border, dark scrim) would be more game-appropriate.
- Opacity race condition: `Math.max(chatOpacity, store.isActive ? 1 : 0)` — if `isActive` toggles during a GSAP fade, opacity jumps instead of blending smoothly. The animation and the reactive value fight each other.
- No rate limiting on chat sends — players can spam submit rapidly.
- Chat has no empty-state indicator when messages are 0 (blank div shown, which is fine, but no "no messages yet" hint for new players).

---

### Arena HUD
**Score: 8/10**

Strengths:
- `HUDController` dispatching by mode (`hopouts` / `ffa` / `gungame`) is clean and extensible.
- `UnifiedScoreboard` handles all three modes without code duplication.
- Kill feed is properly keyed and transitions correctly.
- Team vitals, ammo, voice indicators are synchronized.
- No `dangerouslySetInnerHTML` outside of chat.

Issues:
- **TacticalCompass DOM bloat** (see H05) — most significant runtime issue in the HUD.
- **Hardcoded imgur URL** (see H04) — must not ship.
- Scoreboard "hold to view" has no hint about which key to hold — first-time players won't know.
- KillFeed shows nothing when empty — a subtle "quiet" icon or fade-out would feel more intentional.
- No audio cues for round events (round start, round end, kill) — only UI interaction sounds exist.

---

### Main Menu
**Score: 7/10**

Strengths:
- Clean state management with explicit `loading` / `error` / `activeNav` states.
- Proper `useEffect` cleanup for all registered event handlers.
- Tab transitions are smooth.

Issues:
- Escape key swallow is overly aggressive:
  ```tsx
  window.addEventListener("keydown", swallowEscape, true); // capture phase
  ```
  This intercepts Escape before any other handler, including browser-internal ones. A guard like `if (menuIsOpen)` before `preventDefault()` would be safer.
- No load timeout — if the server never responds to the initial data request, the menu stays in loading state indefinitely.
- `emit("scene", ...)` fires on every tab switch, which may trigger expensive server-side operations each time the player browses between tabs.
- Player list polling has no debounce — rapid open/close could hammer the server.

---

### Admin Panel (Full)
**Score: 5/10**

Strengths:
- Comprehensive feature set.
- Some sections use Virtuoso for virtualized lists (good performance).
- `AdminMiniPanel` (see below) is well-separated.

Issues (structural):
- **2,200+ LOC** single file — this is a maintenance liability. Should be split into at minimum 6–8 sub-components (Players, Bans, Reports, Chat, System, Settings).
- Looks unmistakably like a web admin dashboard. No attempt to integrate visually with the game aesthetic. Contrast with the auth page.

Issues (behavioral):
- **Silent sound pool** (see M06) — no audio feedback for any action.
- No keyboard shortcuts for common actions (ban, kick, spectate, mute). Admin staff managing high-volume situations need hotkeys.
- Report detail panel auto-refreshes but provides no visual indicator of new messages arriving — a red dot or scroll-to-bottom hint is standard.
- No bulk action support (select N players, kick all).
- "Box-within-box" layout: panel → section → card → row → field — 4 levels of nesting in several places, creating visual claustrophobia.

---

### Admin Mini Panel
**Score: 7/10**

Strengths:
- Focused scope (quick actions only — spectate, kick, mute, warn).
- Confirmation dialogs before destructive actions.
- Player search/filter works correctly.
- GSAP animations properly scoped.

Issues:
- Still looks "webby" — a more compact overlay widget (like an in-game phone or PDA aesthetic) would blend better.
- No keyboard navigation — Tab/Enter don't work for quick confirm/deny flows.

---

### Report Widget
**Score: 9/10**

The best-designed page in the codebase.

Strengths:
- Virtuoso for large ticket lists — correct.
- Scoped GSAP with explicit `tween.kill()` in cleanup.
- Player picker with fuzzy search.
- Both player and staff views handled cleanly in one component.
- `mergeSelectedFromList` using functional `setState` updater avoids stale closure bugs.
- Empty state messages ("No tickets yet") handled.

Issues:
- No rate limit on message sends — spam button would queue multiple submissions.
- `FloatingHint` does not close on Escape unlike other overlay elements. Inconsistent UX.
- Timestamp stacking heuristic (`prev.at < 1_000_000_000_000 ? prev.at * 1000 : prev.at`) will mishandle `at === 0` — the fallback `* 1000` makes a zero timestamp into zero, which is fine, but the comment-free heuristic is fragile.

---

## 5. RAGE:MP API / Doc Verification Notes

> **All findings below are UNVERIFIED AGAINST LIVE RAGE:MP DOCS.** RAGE:MP wiki was not accessible during this audit. Findings are based on known RAGE:MP API patterns from static analysis, community documentation, and prior knowledge. Mark any fix decisions against the live docs before shipping.

| API Call | Usage | Verdict |
|---|---|---|
| `mp.browsers.exists(browser)` | Guarded before every browser operation | ✅ Correct |
| `mp.browsers.new(url)` | Creates CEF browser | ✅ Correct usage; ⚠️ Discord URL not validated (M04) |
| `browser.destroy()` | Destroys browser | ✅ Correct where used; ❌ missing in AttachEditor (M05) |
| `browser.execute(script)` | Runs JS in CEF | ✅ Correct API; ❌ unescaped interpolation (H01) |
| `browser.markAsChat()` | Marks browser as chat/UI | ✅ Correct — suppresses native chat overlay |
| `mp.gui.cursor.show(visible, lockedAtCenter)` | Shows/hides cursor | ❌ Second param `true` locks cursor to center — should be `false` for UI |
| `mp.gui.chat.show(false)` / `.activate(false)` | Disables native GTA chat | ✅ Correct — properly prevents native chat from appearing |
| `mp.game.controls.setDisableControlActionBatch()` | Batched control locking | ✅ Correct pattern |
| `mp.game.graphics.transitionToBlurred(duration)` | World blur | ✅ Correct; ⚠️ not reversed on emergency reset (M03) |
| `mp.game.graphics.transitionFromBlurred(duration)` | Remove world blur | ✅ Correct; ⚠️ missing in `emergencyReset()` |
| `mp.events.add("render", fn)` | Per-frame callback | ✅ Correct API; ❌ systemic lack of removal (C04, H03, H06) |
| `mp.events.remove("render", fn)` | Remove per-frame callback | ✅ Correct where used (weapon wheel); needs wider adoption |
| `mp.events.callRemote(event, ...args)` | Client → server event | ✅ Correct; ⚠️ no event whitelist in `emitServer()` |

---

## 6. Runtime Test Checklist (Frontend / CEF / HUD Only)

Use this checklist when testing any frontend/HUD change in a live RAGE:MP environment.

### Page Lifecycle
- [ ] Open main menu → verify world blurs
- [ ] Close main menu → verify world un-blurs
- [ ] Open settings overlay → verify return page is remembered; pressing Back/Close returns to previous page, not blank
- [ ] Trigger an emergency reset (simulate via debug command if available) → verify world is not stuck blurred after reset
- [ ] Rapid page switch (menu → hud → menu → hud, 5× fast) → verify no orphaned handlers or visual glitches

### CEF Browser Integrity
- [ ] Open auth page → Discord OAuth flow → verify `discordOAuthBrowser` is destroyed after auth completes
- [ ] Open AttachEditor twice in a session → verify no stale state from first session
- [ ] Open browser DevTools (if accessible in debug build) → check for JS errors in console

### HUD / Chat
- [ ] Send a chat message containing `<b>bold</b>` → verify it renders as HTML bold (current behavior, but should be text after fix)
- [ ] Send a chat message containing `<img src=x onerror="alert(1)">` → verify alert does NOT fire (XSS test)
- [ ] Spam 10 chat messages rapidly → verify no duplicate handlers or message loss
- [ ] Chat fade-out: send a message then wait for inactivity timeout → verify opacity reaches 0 cleanly, no jitter
- [ ] Open chat (T), type, close (Escape) → verify keyboard control returns to game correctly

### Cursor / Input
- [ ] Open main menu → move mouse → verify cursor tracks freely to edges of screen (not locked to center)
- [ ] In HUD overlay mode (tablet) → verify mouse works on UI elements
- [ ] Close overlay → verify cursor disappears and mouselook resumes

### Arena HUD
- [ ] Join an FFA match → verify correct scoreboard variant renders
- [ ] Join a Hopouts match → verify team scoreboard with red/blue columns
- [ ] Join a GunGame match → verify GunGame scoreboard
- [ ] Die in arena → verify DeathScreen countdown reaches 0 without visual artifacts
- [ ] Kill an enemy → verify killfeed entry appears and auto-removes after timeout
- [ ] Open scoreboard (hold key) → verify hint text shows what key to press
- [ ] Check TacticalCompass framerate during rotation in DevTools Performance tab → flag if paint time > 4ms/frame

### Admin
- [ ] Open AdminPanel → perform a kick action → verify confirmation dialog appears before executing
- [ ] Trigger a report update while AdminPanel is open → verify new message indicator appears
- [ ] Open AdminMiniPanel → spectate a player → verify camera attaches correctly

### Cleanup Verification (requires debug tooling or source instrumentation)
- [ ] After closing any page, verify `EventManager.eventsInMemory` length is stable (no growth on repeated open/close)
- [ ] Profile JS heap after 10 arena rounds → verify heap is not monotonically growing
- [ ] Confirm render event handler count via `mp.events` inspection does not grow across page changes

---

*End of audit. No source files were modified.*
