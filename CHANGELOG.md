# Changelog

All notable changes to this repository are documented here.

The format is based on Keep a Changelog and the project uses Semantic Versioning.

## [Unreleased]

### Added

- Repository baseline.
- FS-RI hand-off state and status history tabs driven by the existing retrocession record fields.
- Event-derived **Activity** tab: selecting a retro case fetches
  `GET /api/v1/events/aggregate/{retrocessionId}?limit=50` with the tenant header
  and renders a newest-first timeline of timestamp, readable event type, event
  status, version, and the payload facts a retro user needs — the case status
  transition, FS-RI hand-off reference/status/contract, ceded premium and loss,
  and the rejection or FS-RI error. The card carries its own loading, error,
  empty, and refresh states plus an event-derived/append-only/source-of-truth
  note, so a slow or unavailable event service never blocks the record.

### Changed

- Refactored the Retrocession remote to the shared EIA operational record design: page head, queue and
  record panel, summary grid, shared tabs, form grid, table wrapper, and a create-retrocession modal.
- Copied the canonical shared `ui.css` and added the `style-loader` / `css-loader` build configuration.
- The record tabs now include Activity: Overview / FS-RI Hand-off / Status History / Activity.

### Tests

- Reworked the Playwright suite for the record layout, create modal, lifecycle, FS-RI hand-off, and
  problem+json error handling.
- Added Playwright coverage for the activity aggregate path and tenant header, newest-first ordering
  and rendering, the empty state, a contained 503, the retro payload facts, refetching on selection,
  and the card refresh.
