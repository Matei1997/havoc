# Plan: RAGE:MP API Audit — Browser/CEF/GUI & Camera/Render/Raycast

## Context

The user requested a read-only audit of RAGE:MP API misuse in two specific families:
1. **Browser / CEF / GUI / input** (`mp.browsers`, `mp.gui`, cursor, input, browser lifecycle)
2. **Camera / rendering / raycasting** (`mp.cameras`, `mp.raycasting`, `mp.game.cam`, `mp.game.graphics`, render events)

Both audits target client-side JavaScript (compiled from TypeScript). The primary compiled bundle is:
`arena-server-backup-master/ragemp-server/client_packages/app.js`

TypeScript sources are located at:
`arena-server-backup-master/ragemp-server/client_packages/src/`

Exploration is **complete**. No live wiki access was attempted — all findings are based on code analysis cross-referenced against known RAGE:MP API signatures. Items that could not be verified against live docs are marked `UNVERIFIED AGAINST LIVE DOCS`.

---

## What Will Be Written

### File 1: `AUDIT_RAGEMP_BROWSER_CEF_GUI.md`
**Output path:** `arena-server-backup-master/ragemp-server/AUDIT_RAGEMP_BROWSER_CEF_GUI.md`

**Contents:**
- 106 total API calls across 12 source files
- 2 findings (1 MEDIUM, 1 LOW)
- Key files: `Browser.class.ts`, `Auth.event.ts`, `AttachEditor.module.ts`, `Speedometer.module.ts`, `Chat.class.ts`, `Player.event.ts`, `Camera.class.ts`, `HopoutsZoneEditor.module.ts`

**Findings to document:**

| ID | Severity | File | Line | Issue |
|----|----------|------|------|-------|
| B01 | MEDIUM | AttachEditor.module.ts | ~379 | `browser.execute()` uses double-escaping anti-pattern: `JSON.stringify(objects).replace(/'/g, "\\'")` embedded in template literal. Fragile — special characters can break execution. |
| B02 | LOW | Camera.class.ts | ~219 | `mp.gui.cursor.position[0]` read without null guard. If cursor is undefined, throws runtime error. Contrast with HopoutsZoneEditor.module.ts:405 which uses proper optional chaining. |

**All other calls verified CORRECT:**
- `mp.browsers.new()` — all 5 call sites correct, existence-checked before use
- `browser.markAsChat()` — called immediately after creation, correct
- `browser.execute()` — 11 call sites, 10 safe; 1 flagged (B01)
- `browser.active` — all 9 set/get operations correct
- `browser.url` — getter/setter used correctly
- `browser.destroy()` — all 4 destruction sites guarded with `mp.browsers.exists()`
- `mp.gui.chat.show()` — 6 call sites, all boolean literals, correct
- `mp.gui.chat.activate()` — 9 call sites, proper open/close pairing
- `mp.gui.chat.push()` — 25 call sites across 5 files, all safe (no raw user input)
- `mp.gui.cursor.show(v, v)` — 20 call sites, always both args equal, correct
- `mp.gui.cursor.visible` — 7 read-only accesses in AttachEditor, correct
- `mp.events.add("browserDomReady", ...)` — 1 registration, filters to correct browser instance
- `mp.browsers.exists()` — 9 call sites, universally applied before use

---

### File 2: `AUDIT_RAGEMP_CAMERA_RENDER_RAYCAST.md`
**Output path:** `arena-server-backup-master/ragemp-server/AUDIT_RAGEMP_CAMERA_RENDER_RAYCAST.md`

**Contents:**
- 91+ total API calls across compiled bundle
- 6 findings (2 CRITICAL, 2 HIGH, 1 MEDIUM, 1 LOW)
- Key sections: `Camera.class.ts`, `Raycast.class.ts`, `AttachEditor.module.ts`

**Findings to document:**

| ID | Severity | File / Location | Line (approx) | Issue |
|----|----------|-----------------|---------------|-------|
| C01 | CRITICAL | Camera.class.ts | ~372 | `setInterval(() => exports.Camera.rotateEntity(x), 0)` — 0ms interval causes a CPU spin-lock. Should use a render-frame event (`mp.events.add("render", ...)`) instead. |
| C02 | CRITICAL | Raycast.class.ts | ~23–27 | `mp.game.graphics.setEntityOverlayPassEnabled()` and `mp.game.graphics.createEntityOverlayBatch()` are **undocumented APIs** accessed with `@ts-ignore`. No `try/catch` wrapping — if these natives are absent in the deployed RAGE:MP build the entire client crashes. `UNVERIFIED AGAINST LIVE DOCS` |
| C03 | HIGH | Raycast.class.ts | ~21 | `this.rayCastInterval = setInterval(this.process.bind(this), 100)` — interval is **never cleared**. No `destroy()` method exists on the class. Causes memory leak and continuous 100ms game API polling for the lifetime of the session. |
| C04 | HIGH | Camera.class.ts | (camera list) | `destroyCamera()` calls `camera.destroy()` but **never removes the entry from `this.list`**. Subsequent calls to `isActive()` or iterating `this.list` will encounter stale destroyed-camera handles, producing incorrect results or native crashes. |
| C05 | MEDIUM | Camera.class.ts | ~217–219 | Variable naming inconsistency in rotation calculation: screen `width` value used where `height` is expected (or vice versa) during cursor-relative rotation math. Risk: slightly incorrect rotation delta on non-square viewports. |
| C06 | LOW | Various render handlers | multiple | 34 `mp.events.add("render", ...)` handlers registered across modules. Each fires every frame. No cumulative budget tracking. On lower-end hardware this compounds per-frame CPU cost. Not a misuse, but a design concern. |

**All other calls verified CORRECT:**
- `mp.cameras.new(name, pos, rot, fov)` — 4-arg form, all 13 call sites correct
- `mp.cameras.exists()` — 16 call sites, all correct
- `camera.setActive(bool)` — correct
- `camera.destroy()` — correct call signature; stale-list issue noted in C04
- `camera.getCoord/setCoord/getRot/setRot/getFov/setFov/getFarClip` — all correct
- `camera.attachTo / attachToPedBone / pointAt / pointAtPedBone / pointAtCoord` — all correct
- `camera.setParams()` — correct 11-arg call
- `camera.setActiveWithInterp(toCamera, duration, ease, ease)` — correct
- `mp.game.cam.renderScriptCams(6 args)` — 11 call sites, 5–6 args (6th optional), correct
- `mp.game.cam.getFollowPedViewMode/setGameplayFollowPedThisUpdate` — correct
- `mp.game.cam.setGameplayCamRelativeHeading/invalidateIdle/invalidateVehicleIdle` — correct
- `mp.game.cam.setFollowVehicleCamViewMode/getGameplayFov/getGameplayCoord/getGameplayCamRot` — correct
- `mp.raycasting.testPointToPoint(pos, pos, entity, flags)` — 4-arg, correct
- `mp.raycasting.testCapsule(pos, pos, radius, entity)` — 4-arg (flags optional), correct
- `mp.game.graphics.drawMarker(18 args)` — correct
- `mp.game.graphics.drawText/drawLine/drawRect/drawPoly` — all correct
- `mp.game.graphics.setDrawOrigin/clearDrawOrigin` — correct
- `mp.game.graphics.getScreenActiveResolution/getAspectRatio` — correct
- `mp.game.graphics.startScreenEffect/stopScreenEffect` — correct
- `mp.game.graphics.transitionToBlurred/transitionFromBlurred` — correct
- `mp.game.graphics.setTimecycleModifier/setTimecycleModifierStrength/clearTimecycleModifier` — correct
- Scaleform calls (`requestScaleformMovie`, `hasScaleformMovieLoaded`, push/pop) — correct
- `mp.game.graphics.startParticleFxNonLoopedAtCoord` — correct

---

## Execution Steps

1. Write `AUDIT_RAGEMP_BROWSER_CEF_GUI.md` to `arena-server-backup-master/ragemp-server/`
2. Write `AUDIT_RAGEMP_CAMERA_RENDER_RAYCAST.md` to `arena-server-backup-master/ragemp-server/`
3. No code changes. No fixes. No refactors.

## Verification

After writing, confirm:
- Both files exist at the specified paths
- Each file contains the findings table, per-finding detail section, and verified-correct section
- Files are valid Markdown
