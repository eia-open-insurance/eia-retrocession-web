# Changelog

All notable changes to this repository are documented here.

The format is based on Keep a Changelog and the project uses Semantic Versioning.

## [Unreleased]

### Added

- Repository baseline.
- FS-RI hand-off state and status history tabs driven by the existing retrocession record fields.

### Changed

- Refactored the Retrocession remote to the shared EIA operational record design: page head, queue and
  record panel, summary grid, shared tabs, form grid, table wrapper, and a create-retrocession modal.
- Copied the canonical shared `ui.css` and added the `style-loader` / `css-loader` build configuration.

### Tests

- Reworked the Playwright suite for the record layout, create modal, lifecycle, FS-RI hand-off, and
  problem+json error handling.
