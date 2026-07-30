# Architecture

## Outcome

The hosted React/Next/Worker/D1 implementation was used as the behavioural
source, then its workable calculation, programme, validation and interaction
rules were ported to a direct-open browser application.

The replacement runtime is:

```text
index.html
  ├── default-data.js
  ├── engine.js
  ├── db.js → IndexedDB
  ├── app.js
  └── styles.css
```

There is no API, server process, cloud binding, package dependency or network
request.

## Design decisions

### Classic scripts

Classic ordered `<script defer>` files work when the application is opened
through `file://`. ES modules were deliberately avoided because file origins
are implementation-dependent and module loading may be blocked by browser
same-origin rules.

### IndexedDB with explicit recovery

IndexedDB supplies transactional structured storage without an external
runtime. The complete project is saved as one atomic versioned snapshot. This
prevents partially committed multi-table updates while retaining explicit
record collections and IDs.

Fallback order:

1. IndexedDB
2. local browser storage
3. in-memory session

The UI never claims durable storage when only memory is available.

### Pure calculation engine

`assets/engine.js` contains date arithmetic, working-calendar logic,
earned-hours calculations, task forecasts, programme redistribution,
procurement dates, variation allocations, checks and snapshot validation. It
does not access the DOM or storage and can be exercised independently.

### Controlled writes

All UI changes:

1. clone the active snapshot;
2. validate and apply the requested mutation;
3. append an audit event;
4. atomically save the snapshot;
5. recalculate derived state; and
6. render the affected view.

If validation or storage fails, the active in-memory state is not replaced and
the UI reports the failure.

### Exports

- CSV: relevant current-page data
- Print/PDF: browser print dialog and local print CSS
- JSON: complete versioned project, all operational records and audit history

JSON is the only restore format.

## Failure controls

- duplicate daily keys are rejected;
- invalid dates and number ranges are rejected before saving;
- task date inversions are rejected;
- source task deletion is blocked;
- user-task deletion is blocked while controlled child records exist;
- variation deletion safely returns linked daily entries to base scope;
- programme reset is date-bounded and confirmation-gated;
- calendar ranges are inclusive and cannot run backwards;
- corrupt/unsupported imports are rejected before replacing local data;
- storage fallback is visible;
- every write is audited; and
- the original source hours are never recalculated from an hourly rate.

## Future multi-user requirement

A truly concurrent multi-user system would require a justified server-side
database, authentication, conflict handling, backups and access control. That
would be a materially different requirement and must not be introduced without
the explicit approval required by `PROJECT-RULES.md`.
