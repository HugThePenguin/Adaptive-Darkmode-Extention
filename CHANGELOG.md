# Changelog

## 1.6.1 — 2026-11-09

- Stop DOM observation, queued color passes and stylesheet/shadow discovery while OFF, and restore styles immediately without scanning the feed.
- Check native dark themes using the existing theme fingerprint instead of traversing all posts on image/media updates.
- Preserve custom video players, including Reddit player hosts, overlays, progress gradients and light/shadow-DOM controls, in both loading CSS and the renderer.
- Ignore nonvisual slider accessibility updates and add media-feed, real playback, pointer/keyboard seeking and OFF regression coverage.

## 1.6.0 — 2026-11-08

- Publish the project under MIT, including original icons and documentation.
- Add English/Japanese Google Forms feedback links, a Support page, privacy-preserving diagnostic preview/copy and a clipboard fallback.
- Keep GitHub Sponsors hidden until the publisher’s profile is ready.
- Update privacy disclosures for voluntarily submitted feedback.
- Declare development dependencies and make browser-test configuration portable.

## 1.5.4 — 2026-10-26

- Fix HTTP startup and OFF restoration on router/admin pages by using random generation available outside secure contexts.

## 1.5.3 — 2026-10-10

- Prevent paint-attribute changes during ordinary pointer/focus movement from triggering site auto-scroll observers.
- Harden malformed preferences, DOM traversal, detached-element reuse and head replacement.

## 1.5.2 — 2026-10-04

- Stabilize native dark-theme detection across scrolling and mixed light/dark sections.

## 1.5.1 — 2026-10-03

- Add early dark loading backgrounds and make settings-page colors preview appearance preferences.

## 1.5.0 — 2026-10-02

- Introduce global defaults, sparse per-site overrides and a full settings page with saved-site tabs.
