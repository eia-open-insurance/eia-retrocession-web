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
- Related-notifications Overview card: selecting a retro case fetches
  `GET /api/v1/notifications?sourceType=RETROCESSION&sourceId={id}` with the
  tenant header (notifications is tenant-scoped, so no book header) and shows the
  total count plus the three newest notifications (number, subject, delivery
  status, and creation time, newest first). Each number opens
  `/notifications?record={id}`, and **View all notifications** opens the
  Notifications queue filtered to this retro case
  (`/notifications?sourceType=RETROCESSION&sourceId={id}`). Rows from another
  source are dropped, an `{ items }` envelope is accepted, and loading, empty,
  and failure states stay inside the card so a slow or unavailable Notifications
  service never blocks the retrocession record.

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
- Added Playwright coverage for related notifications: the `sourceType=RETROCESSION`/`sourceId` query
  and tenant header (with no book header), the count and newest-three preview (newest first, unrelated
  rows dropped), the `/notifications?record={id}` and filtered-queue links, refetching on selection,
  the `{ items }` envelope, the empty state, a contained 503, and rendering the record while the
  Notifications API is still in flight.
