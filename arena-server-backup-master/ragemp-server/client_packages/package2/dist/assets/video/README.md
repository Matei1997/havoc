# Login background video

Place the login screen background video here so it is copied into the build:

- **Filename:** `login-bg.mp4`
- **In repo:** `frontend/public/assets/video/login-bg.mp4`
- **After build:** `client_packages/package2/dist/assets/video/login-bg.mp4`
- **In CEF:** loaded from same origin as the app (e.g. `http://package2/dist/assets/video/login-bg.mp4`).

Recommended: smooth, looping noclip-style cinematic through Los Santos (GTA V). Keep file size reasonable (e.g. 10–30 s loop, compressed). If the file is missing or fails to load, the login screen shows a dark cyan gradient fallback.
