# UI sound effects

Optional. Place these files here for main menu / lobby feedback (they are requested at `/assets/sounds/`):

- **ui_click.mp3** — Button click (mode tabs, size chips, nav, loadout/ranking tabs).
- **ui_hover.mp3** — Hover over nav, mode tabs, size chips, queue, party, loadout/ranking tabs (throttled). If missing, click at low volume is used.
- **ui_confirm.mp3** — Primary/confirm actions (Queue, Enter Freeroam). If missing, `ui_queue.mp3` is used as fallback.
- **ui_queue.mp3** — Used when user presses Queue or Enter Freeroam; also fallback for confirm.
- **ui_match_found.mp3** — When a match is found (ready check appears).
- **ui_vote_warning.mp3** — One-shot when map or weapon vote countdown crosses into the last few seconds (default threshold: ≤3 s). Pooled + short cooldown so map/weapon votes do not double-fire.

Keep files short (e.g. 0.1–0.4 s) and low volume; the app sets volume to ~0.35–0.5. If a file is missing, that sound is skipped or a fallback is used where documented.
