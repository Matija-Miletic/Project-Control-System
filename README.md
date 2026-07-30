# Savannah Project Control — Standalone Edition

A dependency-free, local-first construction project control application for
Savannah Construction. It runs by opening `index.html` directly in a browser.

## Run it

Double-click `index.html`.

Nothing is installed. No web server, Node.js, npm, cloud runtime, account,
ChatGPT service or internet connection is used.

## Included controls

- Overview dashboard with labour, earned-hours, forecast and demand visuals
- Daily labour and task-specific physical progress
- Full date-range Savannah programme with direct 8.9-hour man-day entry
- Immediate downstream weekday redistribution after a manual planning point
- Manual weekend and calendar-exception work
- Clear, confirmation-gated future programme reset
- Current-day red line and individually/all-collapsible past weeks
- Allocation, heatmap and manual programme views
- Target/forecast overlays and total daily demand
- Materials, variations, calendar exceptions and task management
- Default-collapsed registers with record edit/delete modals
- Context help tooltips linked to anchored detailed help in a new tab
- Derived control checks and append-only local audit trail
- Page CSV export, browser print/PDF and complete JSON backup/restore

## Local database

The app uses **IndexedDB**, the browser’s built-in structured database. This is
the appropriate database for a page that must run from `file://` with no
server. A server SQL database cannot be opened safely or portably by
double-clicking an HTML file.

If IndexedDB is blocked for local files, the app falls back to limited browser
storage and then to temporary in-memory operation. The top status badge reports
which mode is active. Complete JSON export/import is always available.

Browser storage belongs to one browser profile. Export a complete JSON backup:

- at each reporting cycle;
- before a material setup change;
- before clearing browser data;
- before changing browser/profile/computer; and
- before restoring the demonstration data.

## Data model

The JSON/IndexedDB snapshot has explicit collections for:

- project settings;
- tasks and task dependencies;
- daily entries;
- programme day values;
- material packages;
- variations;
- inclusive calendar-exception ranges; and
- audit events.

Original source hours, approved changes, actuals and forecasts remain separate.
Approved variation allocations are re-derived from variation records. Forecast
logic never rewrites imported source hours.

## Calculation rules retained from the previous application

For each task:

```text
revised units       = original units + approved variation units
revised budget      = original hours + approved variation hours
budget h/unit       = revised budget / revised units
earned hours        = capped completed units × budget h/unit
productivity var.   = earned hours − approved-scope actual hours
forecast remaining  = remaining units × selected forecast h/unit
forecast total      = approved-scope actual + forecast remaining
forecast variance   = revised budget − forecast total
required staff      = forecast remaining /
                      remaining working days /
                      productive hours per person per day
```

Forecast rate precedence:

1. reasoned manual rate;
2. actual-to-date rate once either progress threshold is reached;
3. revised budget rate before sufficient progress exists.

Programme allowance:

```text
task man-days = ceil(revised budget hours / hours in one man-day)
```

Manual cells remain fixed. Automatic working-day cells are calculated
left-to-right and later dates redistribute the remaining allowance to the task
target finish. A manual zero deliberately blocks that date.

## Files

```text
index.html                 main application
help.html                  detailed anchored operating guide
assets/styles.css          complete responsive and print styling
assets/default-data.js     fictional demonstration project
assets/engine.js           pure calculations and validation
assets/db.js               IndexedDB and fallback persistence
assets/app.js              interface, controls, exports and audit writes
assets/savannah-logo.jpg   supplied Savannah logo
assets/savannah-mark.jpg   supplied Savannah mark
tests/run-tests.html       dependency-free browser test runner
tests/engine.test.js       pure calculation tests
PROJECT-RULES.md           binding architecture rule
ARCHITECTURE.md            design and maintenance notes
VERIFICATION.md            release-gate and UI verification record
```

## Operational limits

- This edition is intentionally single-device and single-browser-profile.
- It has no sign-in or user-level access control.
- Concurrent multi-user editing and automatic cross-device synchronisation are
  not possible without adding a server or peer synchronisation layer.
- CSV and JSON exports are generated directly. PDF export uses the browser’s
  print dialog and print stylesheet.
- Browser storage can be cleared by the user or browser. JSON backups are the
  durable portable record.

## Maintenance

All runtime code is plain JavaScript, HTML and CSS. There is no transpilation,
bundling or package installation. Changes can be made in a text editor and
tested by refreshing `index.html`, then opening `tests/run-tests.html`.

Keep scripts as classic scripts, not ES modules: modern browsers may treat
files loaded through `file://` as opaque origins and block module imports.
