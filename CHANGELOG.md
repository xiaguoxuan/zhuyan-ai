# Changelog

All notable source changes are documented in this file.

## [0.11.0] — 2026-06-08

### Product capabilities

- Added one-shot 2×2 layout Concept generation with local A/B/C/D crops and explicit user selection before formal V1 generation.
- Added restart recovery for successfully generated but not-yet-used Concepts without repeating the Concept model call.
- Added standalone multi-item photo furniture shopping: upload an authorized room or furniture image, extract up to 20 generic furnishing items, edit the list, merge/split entries, track purchases and open fixed marketplace searches.
- Added real visual-analysis progress overlay for the standalone photo furniture workflow.
- Added independent local photo-shopping storage with source-image SHA-256 binding and optimistic revision protection.
- Added Intel Mac x64 internal build-kit scripts alongside the existing Apple Silicon flow.

### Documentation and planning

- Updated Desktop and Runtime documentation for the `0.11.0` / `0.9.0` baseline.
- Added the 90-day real-estate OPC roadmap and today's product/commercial validation notes.
- Documented the current validation stage: single-room value validation focused on rental and landlord furnishing refresh.

### Validation status

- TypeScript, Electron and Renderer production builds pass.
- Runtime package validation passes.
- Standalone photo-shopping persistence, stable IDs, revision conflict rejection, abandonment and source-image integrity checks pass in local simulation.
- This is a source baseline and internal candidate only. No commit, tag, public release, signed installer, notarized macOS package or clean-machine acceptance is implied by the source change alone.

## [0.10.4] — 2026-09-14

### Security and maintenance

- Upgraded Electron from `35.7.5` to `44.3.0`.
- Upgraded electron-builder from `26.0.12` to `26.15.3`.
- Reduced the audited npm dependency findings from 15 to 0 at the time of validation.
- Added a read-only, no-secret GitHub Actions validation workflow with third-party actions pinned to full commit SHAs.
- Added Dependabot configuration for npm and GitHub Actions.
- Added private security-reporting guidance and privacy-safe issue templates.

### Documentation

- Added privacy, security, contribution and demonstration-media policies.
- Clarified local storage, third-party provider data transfer, provider charges and local data deletion.
- Clarified that existing unsigned application packages are internal test builds rather than public binary releases.

## [0.10.3] — 2026-09-14

- Established the stable source baseline with Desktop `0.10.3` and Pi Soft Furnish Runtime `0.8.2`.
- Added encrypted BYOK provider configuration and HTTP/HTTPS compatibility warnings.
- Added task-specific visual-analysis timeouts without automatic retries.
- Added immutable room-design versions, focused revisions, project management and editable version-bound furnishing lists.
- Added authorized, metadata-sanitized visual demonstration media.

[0.10.4]: https://github.com/xiaguoxuan/zhuyan-ai/releases/tag/v0.10.4
