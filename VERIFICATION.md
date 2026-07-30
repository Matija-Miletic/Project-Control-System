# Verification record

The standalone edition was verified on 30 July 2026.

## Release gates

- Every runtime JavaScript file passes `node --check`.
- All 12 pure calculation and validation tests pass.
- The browser test runner reports `12 of 12 tests passed`.
- `index.html`, `help.html` and the browser test runner contain only valid
  local file references, and every referenced file is present.
- Runtime source contains no HTTP URL, network request, WebSocket, module
  import, CommonJS import or package loader.
- No `package.json`, installed dependency, build output, server configuration,
  cloud binding, credential or source-client document is included.

## Direct-file UI checks

The real `index.html` and its four classic scripts were loaded through a
`file://` document in an isolated local browser-DOM harness. The following
workflows passed:

1. Overview rendering, storage status and contextual help.
2. Full programme rendering, today marker and collapsed past weeks.
3. Direct future man-day entry and downstream recalculation.
4. Confirmation-gated future-value reset.
5. Inclusive calendar-range creation.
6. Default-collapsed register and edit/delete modal behaviour.
7. Material record save/cancel/delete controls.
8. Persistence across a fresh document load.
9. CSV, complete JSON and Print/PDF actions.
10. Validated JSON backup import after confirmation.
11. Named form controls and buttons across all nine application routes.

The validation harness used temporary QA tooling only. It is not included in,
required by, or called from the application.

## Re-run locally

Open `tests/run-tests.html` directly in a browser. It requires no server or
installation.
