<!-- markdownlint-disable -->
# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [v1.0.6] - 2026-04-24

### Added
- Add `autoRegisterServiceWorker()` to register from `document.documentElement.dataset`

## [v1.0.5] - 2026-04-17

### Fixed
- Use `skipWaiting()` during install
- Ensure `cache.put()` succeeds via `event.waitUntil(waiting.promise)` in fetch

## [v1.0.4] - 2026-04-17

### Fixed
- Do not handle no-cors cross-origin requests

## [v1.0.3] - 2026-04-16

### Added
- Add `postMessage()`

### Fixed
- Fix normalizing of routes (was missing `prefetch`)
- Fix re-dispatching of events

## [v1.0.2] - 2026-04-15

### Added
- Add support for `RegExp` & `string` in patterns
- Add an optional array of other events to listen for
- Add normalization of routes & names

## [v1.0.1] - 2026-04-14

### Added
- Add minifed versions of `worker.js` & `registry.js`

## [v1.0.0] - 2026-04-14

Initial Release
