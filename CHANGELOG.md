# Changelog

All notable changes to Dancing Brows. Newest first.

## [Unreleased]

### Added
- **Angry mood** (web). Both brows sloping down towards the nose (`\ /`) read as angry; sad is the mirror image (`/ \`). Angry has its own cue text, 😠 💢 😤 🔥 emoji burst, a synthesised growl + stomp, a card on the homepage, a handbook entry and a step in the demo loop.
- Unit tests for angry vs sad (mirror poses, pinch and open-hand cases, small tilts), tracker transitions, demo script, and sound scheduling (47 JS tests in total).

### Changed
- A clear glare now takes priority over happy and sad, so an angry tilt with pinched or open hands still reads as angry.
- The demo loop is 20 s (was 16 s).
- Mood thresholds are still chosen by feel and have not been measured on real users.

## Earlier
- Web version with moods, tutorial and handbook; desktop app hardening (hand identity by motion, frame-rate-independent smoothing, clear camera errors); benchmark script. See the git history.
