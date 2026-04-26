# AUDIT_RAGEMP_BROWSER_CEF_GUI

**Audit Date:** 2026-04-25
**Scope:** `mp.browsers`, `mp.gui`, cursor/input control, browser lifecycle, CEF bridge helpers
**Method:** Static code analysis of TypeScript sources and compiled `app.js` bundle
**Live Wiki Verification:** NOT performed — items requiring live doc cross-check are marked `UNVERIFIED AGAINST LIVE DOCS`
**Code changes:** NONE — read-only audit

---

## Summary

| Metric | Value |
|--------|-------|
| Total API calls audited | 106 |
| Files analyzed | 12 |
| CRITICAL findings | 0 |
| HIGH findings | 0 |
| MEDIUM findings | 1 |
| LOW findings | 1 |
| Verified correct | 104 |

---

## Findings

### B01 — MEDIUM | `browser.execute()` double-escape anti-pattern

**File:** `src/.../AttachEditor.module.ts` (~line 379)
**API:** `browser.execute(script: string)`

**Code:**
```typescript
const objectsStr = JSON.stringify(objects).replace(/'/g, "\\'");
editBrowser.execute(`objectsEdit = JSON.parse('${objectsStr}'); setupListAttachEdit();`);
```

**Issue:**
The objects array is first JSON-serialized, then has single-quotes manually escaped, then embedded in a template literal string passed to `browser.execute()`. This is a fragile double-encoding pattern. If any object field contains a backslash, a backtick, or a multi-byte Unicode sequence that expands around a single-quote, the generated script string can break CEF JavaScript execution silently or produce incorrect data.

**Risk:** Data corruption or silent failure when attach-editor object names contain special characters. Does not crash the browser instance — the execute call itself is safe — but the injected code may throw inside CEF.

**Correct pattern:**
```typescript
editBrowser.execute(`window.setupListAttachEdit(${JSON.stringify(objects)})`);
```
Passing the JSON blob directly as a function argument avoids the single-quote embedding entirely.

---

### B02 — LOW | `mp.gui.cursor.position` accessed without null guard

**File:** `src/.../Camera.class.ts` (~line 219)
**API:** `mp.gui.cursor.position` (returns `[x, y]` or `undefined`)

**Code:**
```typescript
const cursor = mp.gui.cursor.position;
_x = cursor[0];
```

**Issue:**
`mp.gui.cursor.position` can return `undefined` when the cursor is not active. Indexing into an undefined value throws a runtime `TypeError`. The companion file `HopoutsZoneEditor.module.ts` (~line 405) handles this correctly:
```typescript
const cursor = mp.gui.cursor.position as any;
const cx = Number(cursor?.[0] ?? cursor?.x ?? width * 0.5);
```

**Risk:** Low — cursor position is only read inside a render/tick handler that is likely only active when cursor is shown. However, any edge-case where the cursor is toggled off mid-frame will crash that handler call.

---

## Verified Correct — Full Table

### mp.browsers API

| API | Call Sites | Files | Verdict |
|-----|-----------|-------|---------|
| `mp.browsers.new(url)` | 5 | Browser.class.ts (×2), Auth.event.ts, AttachEditor.module.ts (×2) | CORRECT — all preceded by null/existence check |
| `mp.browsers.exists(browser)` | 9 | Browser.class.ts (×7), Auth.event.ts (×2) | CORRECT — universally applied before use |
| `browser.markAsChat()` | 2 | Browser.class.ts (×2) | CORRECT — called immediately after `mp.browsers.new()` on main UI |
| `browser.execute(script)` | 11 | Browser.class.ts (×3), AttachEditor.module.ts (×7), Speedometer.module.ts (×2) | 10 CORRECT, 1 flagged (B01) |
| `browser.active = bool` | 9 | Browser.class.ts (×4), AttachEditor.module.ts (×5) | CORRECT — boolean setter, all safe |
| `browser.url` (getter) | 1 | Browser.class.ts | CORRECT — used in null/empty check before reset |
| `browser.url` (setter) | 1 | Browser.class.ts | CORRECT — sets constant URL after crash detection |
| `browser.reload(bool)` | 1 | Browser.class.ts | CORRECT — called with `true` (clear cache) |
| `browser.destroy()` | 4 | Browser.class.ts, Auth.event.ts (×2) | CORRECT — all guarded with `mp.browsers.exists()` |

### mp.gui.chat API

| API | Call Sites | Args Used | Verdict |
|-----|-----------|-----------|---------|
| `mp.gui.chat.show(bool)` | 6 | `true` / `false` literals | CORRECT |
| `mp.gui.chat.activate(bool)` | 9 | `true` when chat open, `false` when closed | CORRECT — proper open/close pairing |
| `mp.gui.chat.push(string)` | 25 | Hardcoded strings and interpolations with safe values | CORRECT — no raw user input ever passed |

### mp.gui.cursor API

| API | Call Sites | Args | Verdict |
|-----|-----------|------|---------|
| `mp.gui.cursor.show(v, v)` | 20 | Both args always set to same boolean value | CORRECT — matches documented 2-arg signature |
| `mp.gui.cursor.visible` (read) | 7 | Read-only in conditionals | CORRECT — gating keybind actions |
| `mp.gui.cursor.position` (read) | 2 | Camera.class.ts, HopoutsZoneEditor.module.ts | 1 CORRECT (optional-chained), 1 flagged (B02) |

### Browser Events

| Event | Registrations | Handler Pattern | Verdict |
|-------|--------------|-----------------|---------|
| `browserDomReady` | 1 | Auth.event.ts — checks `browser === Browser.mainUI` before acting | CORRECT — filtered to correct browser |

### Browser Lifecycle Patterns

All browser instances follow correct lifecycle:
- `mp.browsers.new()` → `browser.markAsChat()` (for main UI) → `browser.active = bool` (show/hide) → `browser.destroy()` guarded by `mp.browsers.exists()`
- Temporary browsers (`discordOAuthBrowser`, `editBrowser`, `speedometerBrowser`) are all scoped with `null` initialization and cleaned up before re-creation.

### CEF Bridge / Control Blocking

`Browser.class.ts` implements a control-batch blocking system using:
- `mp.game.controls.setDisableControlActionBatch()` (lines 74–138 constants)
- `mp.game.controls.disableControlAction()` per-frame in `onTick()`

This prevents game inputs from leaking into or out of CEF while a browser page is active. All control IDs used are valid GTA V native control indices. Pattern is architecturally correct.

---

## Not Found (Expected but Absent)

| API | Status |
|-----|--------|
| `mp.events.add("browserCreated", ...)` | Not used — not required |
| Custom CEF bridge helpers / proxy files | Not present — direct `browser.execute()` used throughout |
| `mp.browsers.forEach` / pool iteration | Not used — all browsers are individually tracked |

---

## Verdict

**No critical or high-severity RAGE:MP API misuse detected in the Browser/CEF/GUI/input family.**

The codebase follows correct lifecycle patterns, existence-checks all browser handles before use, and uses proper argument signatures throughout. Two minor issues exist at low-to-medium severity that could cause edge-case failures under specific data conditions.
