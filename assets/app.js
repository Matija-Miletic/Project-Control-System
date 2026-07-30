(function () {
  "use strict";

  const E = window.SPCEngine;
  const pageContent = document.getElementById("page-content");
  const feedback = document.getElementById("feedback");
  const itemDialog = document.getElementById("item-dialog");
  const modalBody = document.getElementById("modal-body");
  const confirmDialog = document.getElementById("confirm-dialog");
  const routeNames = new Set([
    "overview",
    "daily",
    "programme",
    "materials",
    "variations",
    "calendar",
    "checks",
    "audit",
    "setup"
  ]);
  const routeMeta = {
    overview: ["Project position", "Overview", "Current labour, programme and control position."],
    daily: ["Actual labour and progress", "Daily input", "Record labour hours and task-specific physical progress."],
    programme: ["Savannah programme", "Programme", "Enter man-days directly and test future labour allocations."],
    materials: ["Procurement control", "Materials", "Track need dates, lead time, orders and confirmed delivery."],
    variations: ["Change control", "Variations", "Separate exposure, approvals and task-budget allocations."],
    calendar: ["Working time", "Calendar", "Record single non-working days or inclusive delay ranges."],
    checks: ["Control gate", "Checks", "Resolve exceptions before issuing the project position."],
    audit: ["Change history", "Audit trail", "Review the local append-only record of project changes."],
    setup: ["Project controls", "Setup", "Maintain project settings, tasks, backups and safeguards."]
  };

  const ui = {
    route: "overview",
    programmeView: "allocations",
    programmePackage: "all",
    programmeShowCompleted: true,
    programmeShowDemand: true,
    programmeShowOverlays: true,
    collapsedWeeks: null,
    programmeScroll: 0
  };

  let state = null;
  let derived = null;

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function humanise(value) {
    return String(value || "")
      .replaceAll("-", " ")
      .replace(/\b\w/g, function (letter) {
        return letter.toUpperCase();
      });
  }

  function number(value, digits) {
    const decimals = digits === undefined ? 1 : digits;
    return Number(value || 0).toLocaleString("en-NZ", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function hours(value) {
    return number(value, 1) + " h";
  }

  function manDays(value) {
    return number(value, 2) + " days";
  }

  function percent(value) {
    return number(Number(value || 0) * 100, 0) + "%";
  }

  function dateLabel(value) {
    return value ? E.shortDate(value) : "—";
  }

  function randomId(prefix) {
    const id = window.crypto && window.crypto.randomUUID
      ? window.crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2);
    return prefix + "-" + id;
  }

  function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function checked(form, name) {
    const field = form.elements.namedItem(name);
    return Boolean(field && field.checked);
  }

  function requiredText(value, label, max) {
    const text = String(value || "").trim();
    if (!text) throw new Error(label + " is required.");
    if (text.length > (max || 500)) throw new Error(label + " is too long.");
    return text;
  }

  function optionalText(value, max) {
    const text = String(value || "").trim();
    if (text.length > (max || 1000)) throw new Error("Entered text is too long.");
    return text || null;
  }

  function numeric(value, label, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(label + " must be a number.");
    if (min !== undefined && parsed < min) throw new Error(label + " must be at least " + min + ".");
    if (max !== undefined && parsed > max) throw new Error(label + " must be no more than " + max + ".");
    return parsed;
  }

  function optionalNumeric(value, label, min, max) {
    if (value === "" || value === null || value === undefined) return null;
    return numeric(value, label, min, max);
  }

  function validDate(value, label, optional) {
    if (!value && optional) return null;
    if (!value) throw new Error(label + " is required.");
    E.parseDate(value);
    return value;
  }

  function taskOptions(selected, blankLabel) {
    const blank = blankLabel
      ? '<option value="">' + escapeHtml(blankLabel) + "</option>"
      : "";
    return blank + state.tasks.map(function (task) {
      return (
        '<option value="' + escapeHtml(task.id) + '"' +
        (task.id === selected ? " selected" : "") +
        ">" + escapeHtml(task.name + " (" + task.trackingUom + ")") + "</option>"
      );
    }).join("");
  }

  function variationOptions(selected) {
    return '<option value="">Base scope</option>' + state.variations.map(function (variation) {
      return (
        '<option value="' + escapeHtml(variation.id) + '"' +
        (variation.id === selected ? " selected" : "") +
        ">" + escapeHtml(variation.id + " — " + variation.title) + "</option>"
      );
    }).join("");
  }

  function statusOptions(values, selected) {
    return values.map(function (value) {
      return (
        '<option value="' + value + '"' + (value === selected ? " selected" : "") + ">" +
        escapeHtml(humanise(value)) + "</option>"
      );
    }).join("");
  }

  function help(topic, summary) {
    return (
      '<a class="help-tip" href="help.html#' + encodeURIComponent(topic) +
      '" target="_blank" rel="noopener" title="' + escapeHtml(summary) +
      '" aria-label="' + escapeHtml(summary + " Open detailed help in a new tab.") + '">?</a>'
    );
  }

  function field(label, control, summary, topic, extraClass) {
    return (
      '<label class="field ' + (extraClass || "") + '">' +
      '<span class="field-label">' + escapeHtml(label) +
      (summary ? help(topic || "field-help", summary) : "") +
      "</span>" + control +
      (summary ? "<small>" + escapeHtml(summary) + "</small>" : "") +
      "</label>"
    );
  }

  function metricCard(label, value, detail, tone, topic) {
    return (
      '<article class="metric-card ' + (tone || "") + '">' +
      '<span class="metric-label">' + escapeHtml(label) +
      (topic ? help(topic, detail) : "") + "</span>" +
      '<strong class="metric-value">' + escapeHtml(value) + "</strong>" +
      '<span class="metric-detail">' + escapeHtml(detail) + "</span>" +
      "</article>"
    );
  }

  function statusPill(value) {
    const tone = {
      complete: "good",
      delivered: "good",
      approved: "good",
      "in-progress": "watch",
      "po-issued": "watch",
      critical: "risk",
      risk: "risk",
      warning: "watch",
      information: "neutral",
      "not-achievable": "risk",
      "over-allocated": "risk",
      "needs-crew": "watch",
      achievable: "good"
    }[value] || "neutral";
    return '<span class="status-pill ' + tone + '">' + escapeHtml(humanise(value)) + "</span>";
  }

  function showFeedback(message, tone) {
    feedback.textContent = message;
    feedback.className = "inline-feedback " + (tone || "success");
    feedback.hidden = false;
    window.clearTimeout(showFeedback.timer);
    showFeedback.timer = window.setTimeout(function () {
      feedback.hidden = true;
    }, 6000);
  }

  function openModal(title, eyebrow, html) {
    document.getElementById("modal-title").textContent = title;
    document.getElementById("modal-eyebrow").textContent = eyebrow || "Record";
    modalBody.innerHTML = html;
    itemDialog.showModal();
    const first = modalBody.querySelector("input:not([type=hidden]), select, textarea, button");
    if (first) window.setTimeout(function () { first.focus(); }, 0);
  }

  function closeModal() {
    if (itemDialog.open) itemDialog.close();
  }

  function confirmAction(title, message, buttonLabel) {
    document.getElementById("confirm-title").textContent = title;
    document.getElementById("confirm-message").textContent = message;
    document.getElementById("confirm-action").textContent = buttonLabel || "Confirm";
    confirmDialog.returnValue = "";
    confirmDialog.showModal();
    return new Promise(function (resolve) {
      confirmDialog.addEventListener("close", function handler() {
        confirmDialog.removeEventListener("close", handler);
        resolve(confirmDialog.returnValue === "confirm");
      });
    });
  }

  function addAudit(draft, details) {
    draft.auditEvents.unshift({
      id: randomId("AUD"),
      timestamp: new Date().toISOString(),
      actor: "Local user",
      entityType: details.entityType,
      entityId: details.entityId,
      action: details.action,
      before: details.before === undefined ? null : details.before,
      after: details.after === undefined ? null : details.after
    });
    if (draft.auditEvents.length > 5000) draft.auditEvents.length = 5000;
  }

  async function commit(details, mutate, options) {
    const draft = clone(state);
    try {
      mutate(draft);
      E.validateSnapshot(draft);
      addAudit(draft, details);
      await window.SPCDB.save(draft);
      state = draft;
      derived = E.derive(state);
      render();
      showFeedback((options && options.message) || "Saved locally.", "success");
      return true;
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "The change was not saved.", "error");
      return false;
    }
  }

  function registerTable(title, summary, columns, rows) {
    return (
      '<details class="register panel">' +
      "<summary><span><strong>" + escapeHtml(title) + "</strong>" +
      "<small>" + escapeHtml(summary) + "</small></span>" +
      '<span class="summary-chevron" aria-hidden="true">⌄</span></summary>' +
      '<div class="table-scroll"><table><thead><tr>' +
      columns.map(function (column) { return "<th>" + escapeHtml(column) + "</th>"; }).join("") +
      "</tr></thead><tbody>" +
      (rows || '<tr><td colspan="' + columns.length + '" class="empty-cell">No records yet.</td></tr>') +
      "</tbody></table></div></details>"
    );
  }

  function recordButton(type, id, label) {
    return (
      '<button class="table-record" type="button" data-action="open-record" ' +
      'data-record-type="' + escapeHtml(type) + '" data-record-id="' + escapeHtml(id) + '">' +
      escapeHtml(label) + "</button>"
    );
  }

  function csvEscape(value) {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
  }

  function toCsv(rows) {
    return rows.map(function (row) {
      return row.map(csvEscape).join(",");
    }).join("\r\n");
  }

  function safeFilename(value) {
    return String(value || "project")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();
  }

  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function renderDemandChart(items, label) {
    const data = items.filter(function (item) { return item.manDays > 0; });
    if (!data.length) {
      return '<div class="chart-empty">No scheduled future demand is available.</div>';
    }
    const width = 960;
    const height = 240;
    const margin = { top: 22, right: 16, bottom: 44, left: 42 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const max = Math.max.apply(null, data.map(function (item) { return item.manDays; }).concat([1]));
    const barWidth = Math.max(2, plotWidth / data.length - 1);
    const bars = data.map(function (item, index) {
      const x = margin.left + index * (plotWidth / data.length);
      const barHeight = item.manDays / max * plotHeight;
      return (
        '<rect x="' + x.toFixed(2) + '" y="' + (margin.top + plotHeight - barHeight).toFixed(2) +
        '" width="' + barWidth.toFixed(2) + '" height="' + barHeight.toFixed(2) +
        '" rx="2"><title>' + escapeHtml(dateLabel(item.date) + ": " + number(item.manDays, 2) + " man-days") +
        "</title></rect>"
      );
    }).join("");
    const tickIndexes = [0, Math.floor((data.length - 1) / 2), data.length - 1];
    const ticks = tickIndexes.map(function (index) {
      const x = margin.left + index * (plotWidth / data.length) + barWidth / 2;
      return '<text x="' + x.toFixed(2) + '" y="' + (height - 15) +
        '" text-anchor="middle">' + escapeHtml(dateLabel(data[index].date)) + "</text>";
    }).join("");
    return (
      '<figure class="native-chart"><figcaption>' + escapeHtml(label) + "</figcaption>" +
      '<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' + escapeHtml(label) + '">' +
      '<line class="axis" x1="' + margin.left + '" y1="' + (margin.top + plotHeight) +
      '" x2="' + (width - margin.right) + '" y2="' + (margin.top + plotHeight) + '"></line>' +
      '<text class="axis-label" x="7" y="' + (margin.top + 8) + '">' + number(max, 1) + "</text>" +
      '<g class="bars">' + bars + '</g><g class="ticks">' + ticks + "</g></svg></figure>"
    );
  }

  function renderOverview() {
    const summary = derived.summary;
    const original = state.tasks.reduce(function (total, task) {
      return total + task.originalBudgetHours;
    }, 0);
    const forecastFinish = E.maxDate(derived.metrics.map(function (metric) {
      return metric.displayedForecastFinish;
    }));
    const critical = derived.checks.filter(function (check) {
      return check.severity === "critical";
    });
    const warning = derived.checks.filter(function (check) {
      return check.severity === "warning";
    });
    const demand = derived.programme.dailyDemand.filter(function (item) {
      return E.compareDates(item.date, derived.programme.today) >= 0;
    });
    const priorityRows = derived.checks.slice(0, 7).map(function (check) {
      return (
        '<button type="button" class="exception-row" data-action="go-route" data-route="' +
        escapeHtml(check.route) + '">' +
        statusPill(check.severity) +
        "<span><strong>" + escapeHtml(check.title) + "</strong><small>" +
        escapeHtml(check.detail) + "</small></span><span aria-hidden=\"true\">→</span></button>"
      );
    }).join("");

    return (
      '<section class="metric-grid">' +
      metricCard("Original allowance", hours(original), "Protected imported baseline", "neutral", "baseline") +
      metricCard("Revised allowance", hours(summary.revisedBudgetHours), "Original plus approved variations", "neutral", "revised-budget") +
      metricCard("Actual labour", hours(summary.actualHours), "Approved-scope hours to status", "", "actual-hours") +
      metricCard("Earned labour", hours(summary.earnedHours), "Budget value of completed quantity", "", "earned-hours") +
      metricCard(
        "Forecast variance",
        hours(summary.forecastVariance),
        summary.forecastVariance >= 0 ? "Within revised allowance" : "Forecast over allowance",
        summary.forecastVariance >= 0 ? "good" : "risk",
        "forecast-variance"
      ) +
      metricCard(
        "Forecast finish",
        dateLabel(forecastFinish),
        E.compareDates(forecastFinish, state.project.targetFinish) <= 0
          ? "Inside project target"
          : "After project target",
        E.compareDates(forecastFinish, state.project.targetFinish) <= 0 ? "good" : "risk",
        "forecast-finish"
      ) +
      "</section>" +
      '<section class="two-column overview-grid">' +
      '<article class="panel chart-panel"><div class="panel-heading"><div><span class="eyebrow">Labour plan</span>' +
      "<h2>Projected daily crew demand</h2></div>" +
      help("demand-chart", "Shows total planned man-days across all visible tasks for each future date.") +
      "</div>" + renderDemandChart(demand, "Total projected man-days by date") + "</article>" +
      '<article class="panel priority-panel"><div class="panel-heading"><div><span class="eyebrow">Control position</span>' +
      "<h2>Priority exceptions</h2></div><div class=\"exception-totals\"><span class=\"risk\">" +
      critical.length + " critical</span><span>" + warning.length + " warnings</span></div></div>" +
      (priorityRows || '<div class="empty-state compact"><strong>No open exceptions</strong><p>The current data passes all active control checks.</p></div>') +
      '<a class="text-link" href="#checks">Open all checks →</a></article></section>' +
      '<section class="panel position-table"><div class="panel-heading"><div><span class="eyebrow">Task position</span>' +
      "<h2>Current forecast by work package</h2></div></div>" +
      '<div class="table-scroll"><table><thead><tr><th>Task</th><th>Progress</th><th>Actual</th>' +
      "<th>Forecast</th><th>Required crew</th><th>Finish</th><th>Position</th></tr></thead><tbody>" +
      derived.metrics.map(function (metric) {
        return (
          "<tr><td><strong>" + escapeHtml(metric.task.name) + "</strong><small>" +
          escapeHtml(metric.task.workPackage) + "</small></td><td>" + percent(metric.progressPercent) +
          "</td><td>" + hours(metric.actualHours) + "</td><td>" + hours(metric.forecastTotalHours) +
          "</td><td>" + (metric.requiredStaffFte === null ? "Not achievable" : number(metric.requiredStaffFte, 2)) +
          "</td><td>" + dateLabel(metric.displayedForecastFinish) + "</td><td>" +
          statusPill(metric.health) + "</td></tr>"
        );
      }).join("") + "</tbody></table></div></section>"
    );
  }

  function renderDaily() {
    const activeTasks = state.tasks.filter(function (task) {
      return !["cancelled", "on-hold"].includes(task.status);
    });
    const lastEntries = state.dailyEntries.slice().sort(function (a, b) {
      return E.compareDates(b.date, a.date);
    });
    const rows = lastEntries.map(function (entry) {
      const task = state.tasks.find(function (item) { return item.id === entry.taskId; });
      return (
        "<tr><td>" + recordButton("daily", entry.id, dateLabel(entry.date)) + "</td>" +
        "<td><strong>" + escapeHtml(task ? task.name : entry.taskId) + "</strong><small>" +
        escapeHtml(entry.workfront || "") + "</small></td><td>" + hours(entry.labourHours) +
        "</td><td>" + number(entry.unitsCompleted, 2) + " " +
        escapeHtml(task ? task.trackingUom : "") + "</td><td>" +
        escapeHtml(entry.delayReason || "—") + "</td></tr>"
      );
    }).join("");

    return (
      '<section class="two-column form-layout"><article class="panel form-panel">' +
      '<div class="panel-heading"><div><span class="eyebrow">New actual</span><h2>Add labour and physical progress</h2></div>' +
      help("daily-input", "Enter one line for each task, date, workfront and variation combination.") +
      '</div><form data-form="add-daily" class="form-grid">' +
      field("Date", '<input name="date" type="date" max="' + state.project.statusDate +
        '" value="' + state.project.statusDate + '" required>', "Cannot be later than the project status date.", "status-date") +
      field("Task", '<select name="taskId" required><option value="">Select task…</option>' +
        activeTasks.map(function (task) {
          return '<option value="' + escapeHtml(task.id) + '">' +
            escapeHtml(task.name + " — " + task.trackingUom) + "</option>";
        }).join("") + "</select>", "The selected task defines what physical quantity means.", "physical-quantity") +
      field("Workfront", '<input name="workfront" maxlength="100" placeholder="Defaults to task workfront">', "Optional area, floor, room group or elevation.", "workfront") +
      field("Variation", '<select name="variationId">' + variationOptions("") + "</select>", "At-risk and rejected variation labour is kept outside base productivity.", "variation-link") +
      field("Labour hours", '<input name="labourHours" type="number" min="0" max="500" step="0.1" required>', "Total labour hours for this task line, not cumulative hours.", "actual-hours") +
      field("Physical quantity completed", '<input name="unitsCompleted" type="number" min="0" max="1000000" step="0.01" required>', "Enter the task's own unit, such as m², lm or each; never an undefined generic unit.", "physical-quantity") +
      field("Rework hours", '<input name="reworkHours" type="number" min="0" max="500" step="0.1" value="0">', "Included within labour hours and recorded separately for visibility.", "rework") +
      field("Delay reason", '<select name="delayReason"><option value="">No delay</option><option>Access unavailable</option><option>Awaiting information</option><option>Awaiting material</option><option>Weather</option><option>Rework</option><option>Other</option></select>', "Required when hours produced no measurable progress.", "delay-reason") +
      field("Notes", '<textarea name="notes" rows="3" maxlength="1000"></textarea>', "", "", "span-2") +
      '<div class="form-actions span-2"><button class="button primary" type="submit">Add daily entry</button></div>' +
      "</form></article>" +
      '<aside class="panel guidance-panel"><span class="eyebrow">Entry rule</span><h2>One task line at a time</h2>' +
      "<p>Enter total labour and the physical quantity completed that day. The system calculates cumulative progress, earned hours and forecast performance.</p>" +
      '<div class="mini-stat"><span>Status date</span><strong>' + dateLabel(state.project.statusDate) + "</strong></div>" +
      '<div class="mini-stat"><span>Hours in one man-day</span><strong>' +
      number(state.project.productiveHoursPerPerson, 1) + " h</strong></div>" +
      '<div class="mini-stat"><span>Entries recorded</span><strong>' +
      state.dailyEntries.length + "</strong></div></aside></section>" +
      registerTable(
        state.dailyEntries.length + " daily entries",
        "Collapsed by default. Select a date to inspect, edit or delete the entry.",
        ["Date", "Task / workfront", "Labour", "Physical progress", "Delay"],
        rows
      )
    );
  }

  function renderMaterials() {
    const statuses = [
      "not-identified", "selection-required", "ready-to-order", "po-issued",
      "in-production", "in-transit", "delivered", "complete"
    ];
    const rows = state.materials.map(function (material) {
      const linked = material.taskIds.map(function (id) {
        const task = state.tasks.find(function (item) { return item.id === id; });
        return task ? task.name : id;
      }).join(", ");
      return (
        "<tr><td>" + recordButton("material", material.id, material.name) +
        "<small>" + escapeHtml(material.component || "") + "</small></td><td>" +
        escapeHtml(linked || "Not linked") + "</td><td>" + dateLabel(material.requiredOnSiteDate) +
        "</td><td>" + dateLabel(material.suggestedOrderDate) + "</td><td>" +
        dateLabel(material.confirmedDeliveryDate) + "</td><td>" + statusPill(material.status) + "</td></tr>"
      );
    }).join("");
    return (
      '<section class="two-column form-layout"><article class="panel form-panel">' +
      '<div class="panel-heading"><div><span class="eyebrow">New package</span><h2>Add material package</h2></div>' +
      help("materials", "Lead time and buffer are counted backwards from the required-on-site date using the working calendar.") +
      '</div><form data-form="add-material" class="form-grid">' +
      field("Package name", '<input name="name" required maxlength="160">') +
      field("Controlling task", '<select name="taskId"><option value="">Not linked yet</option>' + taskOptions("") + "</select>") +
      field("Component", '<input name="component" maxlength="120" placeholder="Timber, fixings, hardware…">') +
      field("Supplier", '<input name="supplier" maxlength="160">') +
      field("Required on site", '<input name="requiredOnSiteDate" type="date">', "Drives the suggested order date.", "materials") +
      field("Lead time, working days", '<input name="leadTimeWorkingDays" type="number" min="0" max="520" value="0" required>') +
      field("Buffer, working days", '<input name="bufferWorkingDays" type="number" min="0" max="60" value="5" required>') +
      field("Status", '<select name="status">' + statusOptions(statuses, "not-identified") + "</select>") +
      field("Purchase order number", '<input name="purchaseOrderNumber" maxlength="100">') +
      field("Purchase order date", '<input name="purchaseOrderDate" type="date">') +
      field("Critical package", '<label class="check-control"><input name="critical" type="checkbox"><span>Raise critical exceptions</span></label>') +
      field("Notes", '<textarea name="notes" rows="3" maxlength="1000"></textarea>', "", "", "span-2") +
      '<div class="form-actions span-2"><button class="button primary" type="submit">Add material package</button></div>' +
      "</form></article>" +
      '<aside class="panel guidance-panel"><span class="eyebrow">Procurement position</span><h2>' +
      state.materials.length + " controlled packages</h2><p>A stated lead time does not mean delivery is confirmed. Record the supplier-confirmed date separately.</p>" +
      '<div class="mini-stat"><span>Critical packages</span><strong>' +
      state.materials.filter(function (item) { return item.critical; }).length + "</strong></div>" +
      '<div class="mini-stat"><span>Delivered / complete</span><strong>' +
      state.materials.filter(function (item) { return ["delivered", "complete"].includes(item.status); }).length +
      "</strong></div></aside></section>" +
      registerTable(
        state.materials.length + " material packages",
        "Select a package to view all details, save changes or delete it.",
        ["Package", "Controlling task", "Need date", "Order by", "Confirmed", "Status"],
        rows
      )
    );
  }

  function renderVariations() {
    const statuses = [
      "potential", "pricing", "submitted", "instructed", "proceeding-at-risk",
      "approved", "partially-approved", "rejected", "complete", "claimed",
      "paid", "closed"
    ];
    const rows = state.variations.map(function (variation) {
      const task = state.tasks.find(function (item) { return item.id === variation.taskId; });
      return (
        "<tr><td>" + recordButton("variation", variation.id, variation.id) +
        "</td><td><strong>" + escapeHtml(variation.title) + "</strong><small>" +
        escapeHtml(task ? task.name : "Not linked") + "</small></td><td>" +
        statusPill(variation.status) + "</td><td>" + hours(variation.exposureHours) +
        "</td><td>" + hours(variation.approvedHours) + "</td><td>" +
        dateLabel(variation.clientResponseDue) + "</td></tr>"
      );
    }).join("");
    return (
      '<section class="two-column form-layout"><article class="panel form-panel">' +
      '<div class="panel-heading"><div><span class="eyebrow">New exposure</span><h2>Add variation</h2></div>' +
      help("variations", "Only approved or partially approved hours and units change the linked task's revised allowance.") +
      '</div><form data-form="add-variation" class="form-grid">' +
      field("Title", '<input name="title" required maxlength="180">') +
      field("Linked task", '<select name="taskId" required><option value="">Select task…</option>' + taskOptions("") + "</select>") +
      field("Status", '<select name="status">' + statusOptions(statuses, "potential") + "</select>") +
      field("Submitted hours", '<input name="submittedHours" type="number" min="0" step="0.1" value="0" required>') +
      field("Exposure hours", '<input name="exposureHours" type="number" min="0" step="0.1" value="0" required>') +
      field("Approved hours", '<input name="approvedHours" type="number" min="0" step="0.1" value="0" required>', "Affects the revised task budget only when status is approved or partially approved.", "approved-variation") +
      field("Approved physical units", '<input name="approvedUnits" type="number" min="0" step="0.01" value="0" required>') +
      field("Client response due", '<input name="clientResponseDue" type="date">') +
      field("Critical-path impact", '<select name="criticalPathImpact"><option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select>') +
      field("Description", '<textarea name="description" rows="3" maxlength="1200"></textarea>', "", "", "span-2") +
      '<div class="form-actions span-2"><button class="button primary" type="submit">Add variation</button></div>' +
      "</form></article>" +
      '<aside class="panel guidance-panel"><span class="eyebrow">Change position</span><h2>' +
      state.variations.length + " controlled changes</h2><p>Potential and at-risk work remains visible without corrupting approved-scope productivity.</p>" +
      '<div class="mini-stat"><span>Total exposure</span><strong>' +
      hours(state.variations.reduce(function (total, item) { return total + item.exposureHours; }, 0)) +
      '</strong></div><div class="mini-stat"><span>Approved allocation</span><strong>' +
      hours(state.variations.reduce(function (total, item) {
        return total + (["approved", "partially-approved"].includes(item.status) ? item.approvedHours : 0);
      }, 0)) + "</strong></div></aside></section>" +
      registerTable(
        state.variations.length + " variations",
        "Select an ID to inspect, edit, update status or delete the record.",
        ["ID", "Change / task", "Status", "Exposure", "Approved", "Response due"],
        rows
      )
    );
  }

  function renderCalendar() {
    const rows = state.calendarExceptions.map(function (item) {
      const span = E.dateRangeInclusive(item.startDate, item.endDate).length;
      return (
        "<tr><td>" + recordButton("calendar", item.id, item.name) + "</td><td>" +
        dateLabel(item.startDate) + "</td><td>" + dateLabel(item.endDate) +
        "</td><td>" + span + (span === 1 ? " day" : " days") + "</td></tr>"
      );
    }).join("");
    return (
      '<section class="two-column form-layout"><article class="panel form-panel">' +
      '<div class="panel-heading"><div><span class="eyebrow">Non-working time</span><h2>Add calendar exception</h2></div>' +
      help("calendar-exceptions", "Enter one day or any inclusive date range. Automatic projections skip every date in the range.") +
      '</div><form data-form="add-calendar" class="form-grid">' +
      field("Reason", '<input name="name" required maxlength="100" placeholder="Weather delay, shutdown, holiday…">') +
      field("Start date", '<input name="startDate" type="date" required>') +
      field("End date", '<input name="endDate" type="date">', "Leave blank for a single day.", "calendar-exceptions") +
      '<div class="form-actions span-2"><button class="button primary" type="submit">Add exception</button></div>' +
      "</form></article>" +
      '<aside class="panel guidance-panel"><span class="eyebrow">Calendar rule</span><h2>Weekdays are automatic</h2>' +
      "<p>Monday to Friday are working days by default. Weekends and recorded exceptions remain editable in the programme for deliberate work.</p>" +
      '<div class="mini-stat"><span>Exception records</span><strong>' +
      state.calendarExceptions.length + '</strong></div><div class="mini-stat"><span>Total excluded dates</span><strong>' +
      derived.exceptionDates.size + "</strong></div></aside></section>" +
      registerTable(
        state.calendarExceptions.length + " calendar exceptions",
        "Select a reason to edit its inclusive range or delete it.",
        ["Reason", "Start", "End", "Excluded"],
        rows
      )
    );
  }

  function renderChecks() {
    const counts = ["critical", "warning", "information"].map(function (severity) {
      return derived.checks.filter(function (check) { return check.severity === severity; }).length;
    });
    return (
      '<section class="metric-grid compact-grid">' +
      metricCard("Critical", String(counts[0]), "Resolve before relying on the report", counts[0] ? "risk" : "good") +
      metricCard("Warnings", String(counts[1]), "Review and explain where appropriate", counts[1] ? "watch" : "good") +
      metricCard("Information", String(counts[2]), "Documented conditions and reminders", "neutral") +
      "</section>" +
      '<section class="panel"><div class="panel-heading"><div><span class="eyebrow">Priority order</span>' +
      "<h2>Open control checks</h2></div>" +
      help("checks", "Checks are generated from the current local data. They do not replace project judgement.") +
      "</div>" +
      (derived.checks.length
        ? '<div class="check-list">' + derived.checks.map(function (check) {
            return (
              '<button type="button" class="check-card ' + check.severity +
              '" data-action="go-route" data-route="' + escapeHtml(check.route) + '">' +
              statusPill(check.severity) + '<span class="check-area">' +
              escapeHtml(humanise(check.area)) + "</span><span><strong>" +
              escapeHtml(check.title) + "</strong><small>" + escapeHtml(check.detail) +
              '</small></span><span class="check-arrow" aria-hidden="true">→</span></button>'
            );
          }).join("") + "</div>"
        : '<div class="empty-state"><strong>No open exceptions</strong><p>The current project data passes all active checks.</p></div>') +
      "</section>"
    );
  }

  function renderAudit() {
    const rows = state.auditEvents.map(function (event) {
      return (
        "<tr><td>" + escapeHtml(new Intl.DateTimeFormat("en-NZ", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Pacific/Auckland"
        }).format(new Date(event.timestamp))) + "</td><td>" +
        escapeHtml(event.actor) + "</td><td>" + escapeHtml(humanise(event.entityType)) +
        "</td><td><strong>" + escapeHtml(event.action) + "</strong><small>" +
        escapeHtml(event.entityId) + "</small></td></tr>"
      );
    }).join("");
    return (
      '<section class="panel"><div class="panel-heading"><div><span class="eyebrow">Local history</span>' +
      "<h2>" + state.auditEvents.length + " recorded events</h2></div>" +
      help("audit", "Every in-app write is recorded. Exported project backups include the audit trail.") +
      "</div><p class=\"panel-intro\">Audit entries are append-only in the interface. Importing an older backup intentionally restores that backup's history.</p>" +
      '<div class="table-scroll tall-table"><table><thead><tr><th>Time</th><th>Actor</th><th>Area</th><th>Action</th></tr></thead><tbody>' +
      rows + "</tbody></table></div></section>"
    );
  }

  function renderSetup() {
    const baseline = state.tasks
      .filter(function (task) { return !task.userCreated; })
      .reduce(function (total, task) {
        return total + task.originalBudgetHours;
      }, 0);
    const taskStatuses = ["not-started", "in-progress", "on-hold", "complete", "cancelled"];
    const taskRows = state.tasks.map(function (task) {
      return (
        "<tr><td>" + recordButton("task", task.id, task.name) +
        "<small>" + escapeHtml(task.workPackage) + "</small></td><td>" +
        escapeHtml(task.trackingUom) + "</td><td>" + hours(task.originalBudgetHours) +
        "</td><td>" + dateLabel(task.targetStart) + "</td><td>" +
        dateLabel(task.targetFinish) + "</td><td>" + number(task.assignedStaff, 1) +
        "</td><td>" + statusPill(task.status) + "</td></tr>"
      );
    }).join("");
    const storage = window.SPCDB.status();
    return (
      '<section class="panel form-panel"><div class="panel-heading"><div><span class="eyebrow">Project settings</span>' +
      "<h2>Control basis</h2></div>" + help("project-settings", "These settings drive status cut-off, working capacity and forecast thresholds.") +
      '</div><form data-form="update-project" class="form-grid three-column">' +
      field("Project name", '<input name="name" required maxlength="180" value="' + escapeHtml(state.project.name) + '">') +
      field("Client", '<input name="client" maxlength="180" value="' + escapeHtml(state.project.client) + '">') +
      field("Project manager", '<input name="projectManager" maxlength="120" value="' + escapeHtml(state.project.projectManager) + '">') +
      field("Site manager", '<input name="siteManager" maxlength="120" value="' + escapeHtml(state.project.siteManager) + '">') +
      field("Status date", '<input name="statusDate" type="date" required value="' + state.project.statusDate + '">', "Actual inputs cannot be later than this date.", "status-date") +
      field("Project target finish", '<input name="targetFinish" type="date" required value="' + state.project.targetFinish + '">') +
      field("Handover date", '<input name="handoverDate" type="date" required value="' + state.project.handoverDate + '">') +
      field("Hours in one man-day", '<input name="productiveHoursPerPerson" type="number" min="0.1" max="24" step="0.1" required value="' + state.project.productiveHoursPerPerson + '">', "Currently 8.9 hours. Changing it recalculates man-day equivalents but never rewrites source hours.", "man-days") +
      field("Forecast threshold, %", '<input name="minimumProgressPercent" type="number" min="1" max="100" step="1" required value="' + number(state.project.minimumProgressPercent * 100, 0) + '">') +
      field("Forecast threshold, units", '<input name="minimumProgressUnits" type="number" min="0.01" step="0.01" required value="' + state.project.minimumProgressUnits + '">') +
      field("Near-critical window, days", '<input name="nearCriticalDays" type="number" min="0" max="90" step="1" required value="' + state.project.nearCriticalDays + '">') +
      '<div class="form-actions span-all"><button class="button primary" type="submit">Save project settings</button></div></form></section>' +

      '<section class="two-column setup-grid"><article class="panel form-panel">' +
      '<div class="panel-heading"><div><span class="eyebrow">Task controls</span><h2>Add Savannah task</h2></div>' +
      help("task-controls", "User-created tasks can be edited and deleted. Imported source allowances remain protected.") +
      '</div><form data-form="add-task" class="form-grid">' +
      field("Task name", '<input name="name" required maxlength="180">') +
      field("Work package", '<input name="workPackage" required maxlength="120">') +
      field("Workfront", '<input name="workfront" required maxlength="100" value="Whole project">') +
      field("Physical unit of measure", '<input name="trackingUom" required maxlength="40" placeholder="m², lm, ea, rooms…">', "Defines the quantity entered against this task.", "physical-quantity") +
      field("Total physical quantity", '<input name="originalUnits" type="number" min="0.01" step="0.01" required>') +
      field("Base man-days", '<input name="baseManDays" type="number" min="0.1" step="0.1" required>', "Converted once to source labour hours using the current hours per man-day.", "man-days") +
      field("Target start", '<input name="targetStart" type="date" required>') +
      field("Target finish", '<input name="targetFinish" type="date" required>') +
      field("Assigned crew", '<input name="assignedStaff" type="number" min="0" step="0.1" value="1" required>') +
      field("Maximum practical crew", '<input name="maxPracticalCrew" type="number" min="0.1" step="0.1">') +
      field("Predecessor", '<select name="predecessorTaskId"><option value="">None</option>' + taskOptions("") + "</select>") +
      field("Status", '<select name="status">' + statusOptions(taskStatuses, "not-started") + "</select>") +
      '<div class="form-actions span-2"><button class="button primary" type="submit">Add task</button></div></form></article>' +
      '<aside class="panel safeguards"><span class="eyebrow">Safeguards</span><h2>Local and recoverable</h2>' +
      '<div class="storage-card"><strong>' + escapeHtml(storage.label) + "</strong><p>" +
      escapeHtml(storage.warning) + "</p></div>" +
      '<div class="reconciliation ' + (Math.abs(baseline - state.project.protectedBaselineHours) <= 0.005 ? "good" : "risk") +
      '"><span>Imported baseline reconciliation</span><strong>' + hours(baseline) +
      " / " + hours(state.project.protectedBaselineHours) + "</strong></div>" +
      '<div class="button-stack"><button class="button secondary" type="button" data-action="export-project">Export complete project</button>' +
      '<button class="button secondary" type="button" data-action="trigger-import">Import project backup</button>' +
      '<button class="button danger-outline" type="button" data-action="reset-demo">Restore demonstration data</button></div>' +
      '<p class="fine-print">Restore replaces the active local project after confirmation. Export first if any current data must be retained.</p></aside></section>' +
      registerTable(
        state.tasks.length + " project tasks",
        "Select a task to update dates, crew, status, workfront, forecast overrides or predecessor. User-created tasks can be deleted.",
        ["Task", "Unit", "Base allowance", "Target start", "Target finish", "Crew", "Status"],
        taskRows
      )
    );
  }

  function buildWeeks(dates, today) {
    const byWeek = new Map();
    dates.forEach(function (date) {
      const weekStart = E.startOfIsoWeek(date);
      if (!byWeek.has(weekStart)) {
        byWeek.set(weekStart, {
          key: weekStart,
          start: weekStart,
          end: E.endOfIsoWeek(date),
          dates: [],
          isPast: E.compareDates(E.endOfIsoWeek(date), today) < 0,
          isCurrent:
            E.compareDates(weekStart, today) <= 0 &&
            E.compareDates(E.endOfIsoWeek(date), today) >= 0
        });
      }
      byWeek.get(weekStart).dates.push(date);
    });
    return Array.from(byWeek.values());
  }

  function programmeInput(row, cell, today) {
    const isManual = cell.kind === "manual" || cell.kind === "actual";
    const suppressProjected = ui.programmeView === "manual" && cell.kind === "projected";
    const value = isManual ? cell.manDays : "";
    const placeholder = suppressProjected ? "" : (cell.manDays === null ? "" : cell.manDays);
    const inTarget =
      E.compareDates(cell.date, row.targetStart) >= 0 &&
      E.compareDates(cell.date, row.targetFinish) <= 0;
    const inForecast =
      E.compareDates(cell.date, row.forecastStart) >= 0 &&
      E.compareDates(cell.date, row.forecastFinish) <= 0;
    const heat = cell.manDays && row.maxPracticalCrew
      ? Math.min(1, cell.manDays / row.maxPracticalCrew)
      : cell.manDays
        ? Math.min(1, cell.manDays / Math.max(1, row.assignedCrew))
        : 0;
    const classes = [
      "programme-cell",
      cell.kind,
      cell.date === today ? "today-column" : "",
      ui.programmeShowOverlays && inTarget ? "target-window" : "",
      ui.programmeShowOverlays && inForecast ? "forecast-window" : "",
      ui.programmeView === "heatmap" ? "heatmap" : ""
    ].filter(Boolean).join(" ");
    return (
      '<td class="' + classes + '" style="--heat:' + heat.toFixed(3) + '">' +
      '<input type="number" min="0" max="100" step="0.1" inputmode="decimal" ' +
      'aria-label="' + escapeHtml(row.taskName + ", " + dateLabel(cell.date) + ", man-days") + '" ' +
      'data-programme-task="' + escapeHtml(row.taskId) + '" data-programme-date="' +
      escapeHtml(cell.date) + '" value="' + escapeHtml(value) + '" placeholder="' +
      escapeHtml(placeholder) + '" title="' + escapeHtml(
        humanise(cell.kind) + (cell.note ? ": " + cell.note : "")
      ) + '"></td>'
    );
  }

  function renderProgramme() {
    const programme = derived.programme;
    const weeks = buildWeeks(programme.dates, programme.today);
    if (ui.collapsedWeeks === null) {
      ui.collapsedWeeks = new Set(weeks.filter(function (week) {
        return week.isPast;
      }).map(function (week) {
        return week.key;
      }));
    }
    const packages = Array.from(new Set(programme.rows.map(function (row) {
      return row.workPackage;
    }))).sort();
    const filteredRows = programme.rows.filter(function (row) {
      return (
        (ui.programmePackage === "all" || row.workPackage === ui.programmePackage) &&
        (ui.programmeShowCompleted || row.status !== "complete")
      );
    });
    const groups = weeks.map(function (week) {
      const collapsed = week.isPast && ui.collapsedWeeks.has(week.key);
      return {
        week,
        collapsed,
        columns: collapsed
          ? [{ type: "week", key: week.key, dates: week.dates }]
          : week.dates.map(function (date) {
              return { type: "date", key: date, date, dates: [date] };
            })
      };
    });
    const columns = groups.flatMap(function (group) { return group.columns; });

    const weekHeaders = groups.map(function (group) {
      const week = group.week;
      const label = "Week of " + dateLabel(week.start);
      return (
        '<th class="week-header ' + (week.isCurrent ? "current-week" : "") +
        '" colspan="' + group.columns.length + '">' +
        (week.isPast
          ? '<button type="button" data-action="toggle-week" data-week="' +
            escapeHtml(week.key) + '" title="' +
            (group.collapsed ? "Expand this past week" : "Collapse this past week") + '">' +
            escapeHtml(label) + " " + (group.collapsed ? "＋" : "−") + "</button>"
          : escapeHtml(label)) + "</th>"
      );
    }).join("");
    const dateHeaders = columns.map(function (column) {
      if (column.type === "week") {
        return '<th class="collapsed-date" title="Past week collapsed">7 days</th>';
      }
      const date = column.date;
      const parsed = E.parseDate(date);
      const day = new Intl.DateTimeFormat("en-NZ", {
        weekday: "short",
        timeZone: "UTC"
      }).format(parsed);
      return (
        '<th class="date-header ' + (date === programme.today ? "today-column" : "") + '">' +
        "<span>" + escapeHtml(day) + "</span><strong>" + parsed.getUTCDate() +
        "</strong><small>" + escapeHtml(new Intl.DateTimeFormat("en-NZ", {
          month: "short",
          timeZone: "UTC"
        }).format(parsed)) + "</small></th>"
      );
    }).join("");

    const bodyRows = filteredRows.map(function (row) {
      const cellsByDate = new Map(row.cells.map(function (cell) {
        return [cell.date, cell];
      }));
      const cells = columns.map(function (column) {
        if (column.type === "date") {
          return programmeInput(row, cellsByDate.get(column.date), programme.today);
        }
        const weekCells = column.dates.map(function (date) {
          return cellsByDate.get(date);
        });
        const total = weekCells.reduce(function (sum, cell) {
          return sum + (cell && cell.manDays ? cell.manDays : 0);
        }, 0);
        const hasManual = weekCells.some(function (cell) {
          return cell && ["manual", "actual"].includes(cell.kind);
        });
        return (
          '<td class="programme-week-summary ' + (hasManual ? "manual" : "") +
          '" title="Collapsed week total">' + (total ? number(total, 1) : "—") + "</td>"
        );
      }).join("");
      const required = Number.isFinite(row.requiredManDaysPerWorkingDay)
        ? number(row.requiredManDaysPerWorkingDay, 2)
        : "No capacity";
      return (
        '<tr data-task-row="' + escapeHtml(row.taskId) + '"><th class="task-column">' +
        "<strong>" + escapeHtml(row.taskName) + "</strong><small>" +
        escapeHtml(row.workPackage) + "</small></th><td class=\"meta-column due-column\">" +
        dateLabel(row.targetFinish) + '</td><td class="meta-column numeric-column">' +
        number(row.revisedManDays, 1) + '</td><td class="meta-column numeric-column">' +
        required + "<small>" + statusPill(row.feasibility) + "</small></td>" + cells + "</tr>"
      );
    }).join("");

    const demandCells = columns.map(function (column) {
      const total = column.dates.reduce(function (sum, date) {
        const item = programme.dailyDemand.find(function (entry) {
          return entry.date === date;
        });
        return sum + (item ? item.manDays : 0);
      }, 0);
      return '<td class="' + (column.type === "week" ? "programme-week-summary" : "demand-cell") +
        '">' + (total ? number(total, 1) : "—") + "</td>";
    }).join("");

    const futureDemand = programme.dailyDemand.filter(function (item) {
      return E.compareDates(item.date, programme.today) >= 0;
    });
    return (
      '<section class="programme-toolbar panel">' +
      '<div class="toolbar-primary"><button class="button danger-outline" type="button" data-action="reset-programme">' +
      "Reset future values</button>" +
      help("programme-reset", "Deletes manual programme values strictly after today and restores default weekday projections. History and today remain.") +
      '<div class="segmented" role="group" aria-label="Programme view">' +
      ["allocations", "heatmap", "manual"].map(function (view) {
        return '<button type="button" data-action="programme-view" data-view="' + view +
          '" class="' + (ui.programmeView === view ? "active" : "") + '">' +
          escapeHtml(humanise(view)) + "</button>";
      }).join("") + "</div></div>" +
      '<div class="toolbar-secondary">' +
      '<label>Work package<select data-programme-control="package"><option value="all">All work packages</option>' +
      packages.map(function (name) {
        return '<option value="' + escapeHtml(name) + '"' +
          (ui.programmePackage === name ? " selected" : "") + ">" + escapeHtml(name) + "</option>";
      }).join("") + "</select></label>" +
      '<label class="check-control"><input type="checkbox" data-programme-control="completed"' +
      (ui.programmeShowCompleted ? " checked" : "") + "><span>Show completed</span></label>" +
      '<label class="check-control"><input type="checkbox" data-programme-control="demand"' +
      (ui.programmeShowDemand ? " checked" : "") + "><span>Demand graph</span></label>" +
      '<label class="check-control"><input type="checkbox" data-programme-control="overlays"' +
      (ui.programmeShowOverlays ? " checked" : "") + "><span>Target / forecast overlays</span></label>" +
      '<button class="button secondary compact" type="button" data-action="toggle-past-all">Toggle all past weeks</button>' +
      "</div></section>" +
      '<div class="programme-legend"><span><i class="actual"></i>Actual / elapsed manual</span>' +
      '<span><i class="manual"></i>Future manual</span><span><i class="projected"></i>Automatic projection</span>' +
      '<span><i class="weekend"></i>Weekend / exception</span><span><i class="today"></i>Today</span></div>' +
      '<section class="panel programme-panel"><div class="programme-scroll" id="programme-scroll"><table class="programme-table">' +
      '<thead><tr><th class="task-column corner" rowspan="2">Task</th><th class="meta-column due-column" rowspan="2">Due</th>' +
      '<th class="meta-column numeric-column" rowspan="2">Man-days</th><th class="meta-column numeric-column" rowspan="2">Daily need</th>' +
      weekHeaders + "</tr><tr>" + dateHeaders + "</tr></thead><tbody>" +
      (ui.programmeShowDemand
        ? '<tr class="demand-row"><th class="task-column">Total demand</th><td class="meta-column">—</td><td class="meta-column">—</td><td class="meta-column">—</td>' +
          demandCells + "</tr>"
        : "") +
      bodyRows + "</tbody></table></div></section>" +
      (ui.programmeShowDemand
        ? '<section class="panel chart-panel programme-demand-chart"><div class="panel-heading"><div><span class="eyebrow">Visible timeline</span>' +
          "<h2>Total daily demand</h2></div></div>" +
          renderDemandChart(futureDemand, "Total planned man-days from today") + "</section>"
        : "") +
      '<section class="programme-notes"><p><strong>1 man-day = ' +
      number(state.project.productiveHoursPerPerson, 1) +
      " labour hours.</strong> Type a value into any date cell. Later automatic weekdays recalculate immediately. Enter 0 to deliberately block a day.</p>" +
      '<p>The red column marks today (' + dateLabel(programme.today) +
      "). Past weeks start collapsed; current and future weeks remain visible.</p></section>"
    );
  }

  function modalActions(type, id, deletable) {
    return (
      '<div class="modal-actions">' +
      (deletable
        ? '<button class="button danger" type="button" data-action="delete-record" data-record-type="' +
          escapeHtml(type) + '" data-record-id="' + escapeHtml(id) + '">Delete</button>'
        : "<span></span>") +
      '<div><button class="button secondary" type="button" data-action="close-modal">Cancel</button>' +
      '<button class="button primary" type="submit">Save changes</button></div></div>'
    );
  }

  function openRecord(type, id) {
    if (type === "daily") {
      const entry = state.dailyEntries.find(function (item) { return item.id === id; });
      if (!entry) return;
      openModal("Edit daily entry", dateLabel(entry.date),
        '<form data-form="edit-daily" class="form-grid"><input type="hidden" name="id" value="' + escapeHtml(entry.id) + '">' +
        field("Date", '<input name="date" type="date" max="' + state.project.statusDate + '" required value="' + entry.date + '">') +
        field("Task", '<select name="taskId" required>' + taskOptions(entry.taskId) + "</select>") +
        field("Workfront", '<input name="workfront" maxlength="100" value="' + escapeHtml(entry.workfront || "") + '">') +
        field("Variation", '<select name="variationId">' + variationOptions(entry.variationId || "") + "</select>") +
        field("Labour hours", '<input name="labourHours" type="number" min="0" max="500" step="0.1" required value="' + entry.labourHours + '">') +
        field("Physical quantity completed", '<input name="unitsCompleted" type="number" min="0" step="0.01" required value="' + entry.unitsCompleted + '">') +
        field("Rework hours", '<input name="reworkHours" type="number" min="0" step="0.1" value="' + entry.reworkHours + '">') +
        field("Delay reason", '<input name="delayReason" maxlength="120" value="' + escapeHtml(entry.delayReason || "") + '">') +
        field("Notes", '<textarea name="notes" rows="3" maxlength="1000">' + escapeHtml(entry.notes || "") + "</textarea>", "", "", "span-2") +
        modalActions(type, id, true) + "</form>");
      return;
    }

    if (type === "material") {
      const item = state.materials.find(function (record) { return record.id === id; });
      if (!item) return;
      const statuses = [
        "not-identified", "selection-required", "ready-to-order", "po-issued",
        "in-production", "in-transit", "delivered", "complete"
      ];
      openModal("Edit material package", item.id,
        '<form data-form="edit-material" class="form-grid"><input type="hidden" name="id" value="' + escapeHtml(item.id) + '">' +
        field("Package name", '<input name="name" required maxlength="160" value="' + escapeHtml(item.name) + '">') +
        field("Controlling task", '<select name="taskId"><option value="">Not linked</option>' + taskOptions(item.taskIds[0] || "") + "</select>") +
        field("Component", '<input name="component" maxlength="120" value="' + escapeHtml(item.component || "") + '">') +
        field("Supplier", '<input name="supplier" maxlength="160" value="' + escapeHtml(item.supplier || "") + '">') +
        field("Required on site", '<input name="requiredOnSiteDate" type="date" value="' + escapeHtml(item.requiredOnSiteDate || "") + '">') +
        field("Lead time, working days", '<input name="leadTimeWorkingDays" type="number" min="0" max="520" required value="' + Number(item.leadTimeWorkingDays || 0) + '">') +
        field("Buffer, working days", '<input name="bufferWorkingDays" type="number" min="0" max="60" required value="' + Number(item.bufferWorkingDays || 0) + '">') +
        field("Status", '<select name="status">' + statusOptions(statuses, item.status) + "</select>") +
        field("Purchase order number", '<input name="purchaseOrderNumber" maxlength="100" value="' + escapeHtml(item.purchaseOrderNumber || "") + '">') +
        field("Purchase order date", '<input name="purchaseOrderDate" type="date" value="' + escapeHtml(item.purchaseOrderDate || "") + '">') +
        field("Confirmed delivery", '<input name="confirmedDeliveryDate" type="date" value="' + escapeHtml(item.confirmedDeliveryDate || "") + '">') +
        field("Critical package", '<label class="check-control"><input name="critical" type="checkbox"' + (item.critical ? " checked" : "") + "><span>Raise critical exceptions</span></label>") +
        field("Notes", '<textarea name="notes" rows="3" maxlength="1000">' + escapeHtml(item.notes || "") + "</textarea>", "", "", "span-2") +
        modalActions(type, id, true) + "</form>");
      return;
    }

    if (type === "variation") {
      const item = state.variations.find(function (record) { return record.id === id; });
      if (!item) return;
      const statuses = [
        "potential", "pricing", "submitted", "instructed", "proceeding-at-risk",
        "approved", "partially-approved", "rejected", "complete", "claimed",
        "paid", "closed"
      ];
      openModal("Edit variation", item.id,
        '<form data-form="edit-variation" class="form-grid"><input type="hidden" name="id" value="' + escapeHtml(item.id) + '">' +
        field("Title", '<input name="title" required maxlength="180" value="' + escapeHtml(item.title) + '">') +
        field("Linked task", '<select name="taskId" required>' + taskOptions(item.taskId || "") + "</select>") +
        field("Status", '<select name="status">' + statusOptions(statuses, item.status) + "</select>") +
        field("Submitted hours", '<input name="submittedHours" type="number" min="0" step="0.1" required value="' + item.submittedHours + '">') +
        field("Exposure hours", '<input name="exposureHours" type="number" min="0" step="0.1" required value="' + item.exposureHours + '">') +
        field("Approved hours", '<input name="approvedHours" type="number" min="0" step="0.1" required value="' + item.approvedHours + '">') +
        field("Approved physical units", '<input name="approvedUnits" type="number" min="0" step="0.01" required value="' + item.approvedUnits + '">') +
        field("Client response due", '<input name="clientResponseDue" type="date" value="' + escapeHtml(item.clientResponseDue || "") + '">') +
        field("Critical-path impact", '<select name="criticalPathImpact">' +
          statusOptions(["unknown", "yes", "no"], item.criticalPathImpact) + "</select>") +
        field("Description", '<textarea name="description" rows="4" maxlength="1200">' + escapeHtml(item.description || "") + "</textarea>", "", "", "span-2") +
        modalActions(type, id, true) + "</form>");
      return;
    }

    if (type === "calendar") {
      const item = state.calendarExceptions.find(function (record) { return record.id === id; });
      if (!item) return;
      openModal("Edit calendar exception", item.id,
        '<form data-form="edit-calendar" class="form-grid"><input type="hidden" name="id" value="' + escapeHtml(item.id) + '">' +
        field("Reason", '<input name="name" required maxlength="100" value="' + escapeHtml(item.name) + '">') +
        field("Start date", '<input name="startDate" type="date" required value="' + item.startDate + '">') +
        field("End date", '<input name="endDate" type="date" required value="' + item.endDate + '">') +
        modalActions(type, id, true) + "</form>");
      return;
    }

    if (type === "task") {
      const item = state.tasks.find(function (record) { return record.id === id; });
      if (!item) return;
      const predecessor = (state.taskDependencies.find(function (relation) {
        return relation[0] === item.id;
      }) || [])[1] || "";
      const otherTasks = state.tasks.filter(function (task) { return task.id !== item.id; });
      const predecessorOptions = '<option value="">None</option>' + otherTasks.map(function (task) {
        return '<option value="' + escapeHtml(task.id) + '"' +
          (task.id === predecessor ? " selected" : "") + ">" + escapeHtml(task.name) + "</option>";
      }).join("");
      const readOnly = item.userCreated ? "" : " readonly";
      openModal("Edit task", item.id,
        '<form data-form="edit-task" class="form-grid"><input type="hidden" name="id" value="' + escapeHtml(item.id) + '">' +
        field("Task name", '<input name="name" required maxlength="180" value="' + escapeHtml(item.name) + '"' + readOnly + ">") +
        field("Work package", '<input name="workPackage" required maxlength="120" value="' + escapeHtml(item.workPackage) + '"' + readOnly + ">") +
        field("Workfront", '<input name="workfront" required maxlength="100" value="' + escapeHtml(item.workfront) + '">') +
        field("Physical unit of measure", '<input name="trackingUom" required maxlength="40" value="' + escapeHtml(item.trackingUom) + '"' + readOnly + ">") +
        field("Total physical quantity", '<input name="originalUnits" type="number" min="0.01" step="0.01" required value="' + item.originalUnits + '"' + readOnly + ">") +
        field("Base man-days", '<input name="baseManDays" type="number" min="0.1" step="0.1" required value="' +
          E.round(item.originalBudgetHours / state.project.productiveHoursPerPerson, 2) + '"' + readOnly + ">") +
        field("Target start", '<input name="targetStart" type="date" required value="' + item.targetStart + '">') +
        field("Target finish", '<input name="targetFinish" type="date" required value="' + item.targetFinish + '">') +
        field("Assigned crew", '<input name="assignedStaff" type="number" min="0" step="0.1" required value="' + item.assignedStaff + '">') +
        field("Maximum practical crew", '<input name="maxPracticalCrew" type="number" min="0.1" step="0.1" value="' + (item.maxPracticalCrew || "") + '">') +
        field("Access available", '<input name="accessDate" type="date" value="' + escapeHtml(item.accessDate || "") + '">') +
        field("Predecessor", '<select name="predecessorTaskId">' + predecessorOptions + "</select>") +
        field("Status", '<select name="status">' + statusOptions(["not-started", "in-progress", "on-hold", "complete", "cancelled"], item.status) + "</select>") +
        field("Criticality", '<select name="criticality">' + statusOptions(["unknown", "critical", "near-critical", "non-critical"], item.criticality) + "</select>") +
        field("Manual forecast rate, h/unit", '<input name="manualForecastRate" type="number" min="0.0001" step="0.0001" value="' + (item.manualForecastRate || "") + '">', "Optional reasoned override. Leave blank for automatic basis.", "forecast-overrides") +
        field("Manual forecast start", '<input name="manualForecastStart" type="date" value="' + escapeHtml(item.manualForecastStart || "") + '">') +
        field("Manual forecast finish", '<input name="manualForecastFinish" type="date" value="' + escapeHtml(item.manualForecastFinish || "") + '">') +
        modalActions(type, id, item.userCreated) + "</form>");
    }
  }

  function nextVariationId() {
    const max = state.variations.reduce(function (value, item) {
      const match = String(item.id).match(/(\d+)$/);
      return Math.max(value, match ? Number(match[1]) : 0);
    }, 0);
    return "VO-" + String(max + 1).padStart(3, "0");
  }

  function variationStatusFor(id, draft) {
    if (!id) return "none";
    const variation = draft.variations.find(function (item) { return item.id === id; });
    if (!variation) throw new Error("Select a valid variation.");
    if (["approved", "partially-approved"].includes(variation.status)) return "approved";
    if (variation.status === "rejected") return "rejected";
    return "at-risk";
  }

  function dailyRecord(values, draft, id) {
    const task = draft.tasks.find(function (item) { return item.id === values.taskId; });
    if (!task) throw new Error("Select a valid task.");
    if (["cancelled", "on-hold"].includes(task.status)) {
      throw new Error("This task is not active. Change its status before recording progress.");
    }
    const date = validDate(values.date, "Date");
    if (E.compareDates(date, draft.project.statusDate) > 0) {
      throw new Error("Daily entries cannot be later than the project status date.");
    }
    const labourHours = numeric(values.labourHours, "Labour hours", 0, 500);
    const unitsCompleted = numeric(values.unitsCompleted, "Physical quantity", 0, 1000000);
    const reworkHours = numeric(values.reworkHours || 0, "Rework hours", 0, labourHours);
    if (labourHours === 0 && unitsCompleted === 0) {
      throw new Error("Enter labour hours, completed physical quantity, or both.");
    }
    const workfront = optionalText(values.workfront, 100) || task.workfront;
    const variationId = optionalText(values.variationId, 80);
    const duplicate = draft.dailyEntries.find(function (entry) {
      return (
        entry.id !== id &&
        entry.taskId === task.id &&
        entry.date === date &&
        (entry.workfront || "") === workfront &&
        (entry.variationId || "") === (variationId || "")
      );
    });
    if (duplicate) {
      throw new Error("That task, date, workfront and variation combination already exists. Edit the existing line.");
    }
    return {
      id: id || randomId("DE"),
      taskId: task.id,
      date,
      labourHours,
      unitsCompleted,
      reworkHours,
      variationId,
      variationStatus: variationStatusFor(variationId, draft),
      delayReason: optionalText(values.delayReason, 120),
      workfront,
      notes: optionalText(values.notes, 1000)
    };
  }

  function materialRecord(values, form, id) {
    return {
      id: id || randomId("MAT"),
      name: requiredText(values.name, "Package name", 160),
      component: optionalText(values.component, 120),
      supplier: optionalText(values.supplier, 160),
      leadTimeWorkingDays: numeric(values.leadTimeWorkingDays, "Lead time", 0, 520),
      bufferWorkingDays: numeric(values.bufferWorkingDays, "Buffer", 0, 60),
      taskIds: values.taskId ? [values.taskId] : [],
      requiredOnSiteDate: validDate(values.requiredOnSiteDate, "Required-on-site date", true),
      forecastNeedDate: null,
      manualNeedDate: null,
      suggestedOrderDate: null,
      purchaseOrderNumber: optionalText(values.purchaseOrderNumber, 100),
      purchaseOrderDate: validDate(values.purchaseOrderDate, "Purchase order date", true),
      confirmedDeliveryDate: validDate(values.confirmedDeliveryDate, "Confirmed delivery date", true),
      status: requiredText(values.status, "Status", 40),
      critical: checked(form, "critical"),
      notes: optionalText(values.notes, 1000)
    };
  }

  function variationRecord(values, id) {
    return {
      id: id || nextVariationId(),
      taskId: requiredText(values.taskId, "Linked task", 80),
      title: requiredText(values.title, "Title", 180),
      status: requiredText(values.status, "Status", 40),
      submittedHours: numeric(values.submittedHours, "Submitted hours", 0, 1000000),
      approvedHours: numeric(values.approvedHours, "Approved hours", 0, 1000000),
      approvedUnits: numeric(values.approvedUnits, "Approved physical units", 0, 1000000),
      exposureHours: numeric(values.exposureHours, "Exposure hours", 0, 1000000),
      criticalPathImpact: requiredText(values.criticalPathImpact, "Critical-path impact", 20),
      clientResponseDue: validDate(values.clientResponseDue, "Client response due", true),
      description: optionalText(values.description, 1200)
    };
  }

  function taskRecord(values, draft, existing) {
    const targetStart = validDate(values.targetStart, "Target start");
    const targetFinish = validDate(values.targetFinish, "Target finish");
    if (E.compareDates(targetFinish, targetStart) < 0) {
      throw new Error("Target finish cannot be before target start.");
    }
    const userCreated = existing ? existing.userCreated : true;
    const source = existing || {};
    const originalBudgetHours = userCreated
      ? E.round(
          numeric(values.baseManDays, "Base man-days", 0.1, 1000000) *
            draft.project.productiveHoursPerPerson,
          4
        )
      : source.originalBudgetHours;
    const manualForecastStart = validDate(values.manualForecastStart, "Manual forecast start", true);
    const manualForecastFinish = validDate(values.manualForecastFinish, "Manual forecast finish", true);
    if (
      manualForecastStart &&
      manualForecastFinish &&
      E.compareDates(manualForecastFinish, manualForecastStart) < 0
    ) {
      throw new Error("Manual forecast finish cannot be before its start.");
    }
    return {
      id: existing ? existing.id : randomId("ST"),
      name: userCreated ? requiredText(values.name, "Task name", 180) : source.name,
      workPackage: userCreated ? requiredText(values.workPackage, "Work package", 120) : source.workPackage,
      workfront: requiredText(values.workfront, "Workfront", 100),
      trackingUom: userCreated ? requiredText(values.trackingUom, "Physical unit", 40) : source.trackingUom,
      progressMethod: userCreated ? "continuous" : source.progressMethod,
      originalUnits: userCreated
        ? numeric(values.originalUnits, "Total physical quantity", 0.01, 100000000)
        : source.originalUnits,
      approvedVariationUnits: source.approvedVariationUnits || 0,
      originalBudgetHours,
      approvedVariationHours: source.approvedVariationHours || 0,
      assignedStaff: numeric(values.assignedStaff, "Assigned crew", 0, 1000),
      maxPracticalCrew: optionalNumeric(values.maxPracticalCrew, "Maximum practical crew", 0.1, 1000),
      targetStart,
      targetFinish,
      originalStart: existing ? source.originalStart : targetStart,
      originalFinish: existing ? source.originalFinish : targetFinish,
      criticality: values.criticality || (existing ? source.criticality : "unknown"),
      criticalitySource: values.criticality && values.criticality !== "unknown" ? "manual" : "unknown",
      status: requiredText(values.status, "Status", 30),
      manualForecastRate: optionalNumeric(values.manualForecastRate, "Manual forecast rate", 0.0001, 1000000),
      manualForecastStart,
      manualForecastFinish,
      accessDate: validDate(values.accessDate, "Access date", true),
      userCreated
    };
  }

  function updatePredecessor(draft, taskId, predecessorTaskId) {
    draft.taskDependencies = draft.taskDependencies.filter(function (relation) {
      return relation[0] !== taskId;
    });
    if (predecessorTaskId) {
      if (predecessorTaskId === taskId) throw new Error("A task cannot depend on itself.");
      draft.taskDependencies.push([taskId, predecessorTaskId]);
    }
  }

  async function handleForm(form) {
    const kind = form.dataset.form;
    const values = formData(form);

    if (kind === "add-daily" || kind === "edit-daily") {
      const id = kind === "edit-daily" ? values.id : null;
      const before = id && state.dailyEntries.find(function (item) { return item.id === id; });
      const saved = await commit({
        entityType: "daily-entry",
        entityId: id || "new",
        action: id ? "Daily entry updated" : "Daily entry added",
        before: before ? clone(before) : null
      }, function (draft) {
        const record = dailyRecord(values, draft, id);
        if (id) {
          const index = draft.dailyEntries.findIndex(function (item) { return item.id === id; });
          if (index < 0) throw new Error("The daily entry no longer exists.");
          draft.dailyEntries[index] = record;
        } else {
          draft.dailyEntries.push(record);
        }
      }, { message: id ? "Daily entry updated." : "Daily entry added." });
      if (saved) {
        closeModal();
        if (!id) form.reset();
      }
      return;
    }

    if (kind === "add-material" || kind === "edit-material") {
      const id = kind === "edit-material" ? values.id : null;
      const before = id && state.materials.find(function (item) { return item.id === id; });
      const saved = await commit({
        entityType: "material",
        entityId: id || "new",
        action: id ? "Material package updated" : "Material package added",
        before: before ? clone(before) : null
      }, function (draft) {
        if (values.taskId && !draft.tasks.some(function (task) { return task.id === values.taskId; })) {
          throw new Error("Select a valid controlling task.");
        }
        const record = materialRecord(values, form, id);
        if (id) {
          const index = draft.materials.findIndex(function (item) { return item.id === id; });
          if (index < 0) throw new Error("The material package no longer exists.");
          draft.materials[index] = record;
        } else draft.materials.push(record);
        E.updateMaterialOrderDates(draft);
      }, { message: id ? "Material package updated." : "Material package added." });
      if (saved) {
        closeModal();
        if (!id) form.reset();
      }
      return;
    }

    if (kind === "add-variation" || kind === "edit-variation") {
      const id = kind === "edit-variation" ? values.id : null;
      const before = id && state.variations.find(function (item) { return item.id === id; });
      const saved = await commit({
        entityType: "variation",
        entityId: id || "new",
        action: id ? "Variation updated" : "Variation added",
        before: before ? clone(before) : null
      }, function (draft) {
        if (!draft.tasks.some(function (task) { return task.id === values.taskId; })) {
          throw new Error("Select a valid linked task.");
        }
        const record = variationRecord(values, id);
        if (id) {
          const index = draft.variations.findIndex(function (item) { return item.id === id; });
          if (index < 0) throw new Error("The variation no longer exists.");
          draft.variations[index] = record;
        } else draft.variations.push(record);
        E.recalculateVariationAllocations(draft);
        draft.dailyEntries.forEach(function (entry) {
          entry.variationStatus = variationStatusFor(entry.variationId, draft);
        });
      }, { message: id ? "Variation updated." : "Variation added." });
      if (saved) {
        closeModal();
        if (!id) form.reset();
      }
      return;
    }

    if (kind === "add-calendar" || kind === "edit-calendar") {
      const id = kind === "edit-calendar" ? values.id : null;
      const startDate = validDate(values.startDate, "Start date");
      const endDate = validDate(values.endDate || values.startDate, "End date");
      if (E.compareDates(endDate, startDate) < 0) {
        showFeedback("End date cannot be before start date.", "error");
        return;
      }
      const record = {
        id: id || randomId("CAL"),
        startDate,
        endDate,
        name: requiredText(values.name, "Reason", 100),
        treatment: "non-working"
      };
      const before = id && state.calendarExceptions.find(function (item) { return item.id === id; });
      const saved = await commit({
        entityType: "calendar-exception",
        entityId: id || "new",
        action: id ? "Calendar exception updated" : "Calendar exception added",
        before: before ? clone(before) : null
      }, function (draft) {
        if (id) {
          const index = draft.calendarExceptions.findIndex(function (item) { return item.id === id; });
          if (index < 0) throw new Error("The calendar exception no longer exists.");
          draft.calendarExceptions[index] = record;
        } else draft.calendarExceptions.push(record);
      }, { message: id ? "Calendar exception updated." : "Calendar exception added." });
      if (saved) {
        closeModal();
        if (!id) form.reset();
      }
      return;
    }

    if (kind === "add-task" || kind === "edit-task") {
      const id = kind === "edit-task" ? values.id : null;
      const before = id && state.tasks.find(function (item) { return item.id === id; });
      const saved = await commit({
        entityType: "task",
        entityId: id || "new",
        action: id ? "Task updated" : "Task added",
        before: before ? clone(before) : null
      }, function (draft) {
        const existing = id && draft.tasks.find(function (item) { return item.id === id; });
        if (id && !existing) throw new Error("The task no longer exists.");
        const record = taskRecord(values, draft, existing || null);
        if (id) {
          const index = draft.tasks.findIndex(function (item) { return item.id === id; });
          draft.tasks[index] = record;
        } else draft.tasks.push(record);
        updatePredecessor(draft, record.id, values.predecessorTaskId || "");
      }, { message: id ? "Task updated." : "Task added." });
      if (saved) {
        closeModal();
        if (!id) form.reset();
      }
      return;
    }

    if (kind === "update-project") {
      const before = clone(state.project);
      await commit({
        entityType: "project",
        entityId: state.project.id,
        action: "Project settings updated",
        before
      }, function (draft) {
        draft.project.name = requiredText(values.name, "Project name", 180);
        draft.project.client = optionalText(values.client, 180) || "";
        draft.project.projectManager = optionalText(values.projectManager, 120) || "";
        draft.project.siteManager = optionalText(values.siteManager, 120) || "";
        draft.project.statusDate = validDate(values.statusDate, "Status date");
        draft.project.targetFinish = validDate(values.targetFinish, "Target finish");
        draft.project.handoverDate = validDate(values.handoverDate, "Handover date");
        draft.project.productiveHoursPerPerson = numeric(values.productiveHoursPerPerson, "Hours in one man-day", 0.1, 24);
        draft.project.minimumProgressPercent = numeric(values.minimumProgressPercent, "Forecast percentage threshold", 1, 100) / 100;
        draft.project.minimumProgressUnits = numeric(values.minimumProgressUnits, "Forecast unit threshold", 0.01, 1000000);
        draft.project.nearCriticalDays = numeric(values.nearCriticalDays, "Near-critical days", 0, 90);
      }, { message: "Project settings updated." });
    }
  }

  async function deleteRecord(type, id) {
    let item;
    let label;
    if (type === "daily") {
      item = state.dailyEntries.find(function (record) { return record.id === id; });
      label = item ? "daily entry for " + dateLabel(item.date) : "daily entry";
    } else if (type === "material") {
      item = state.materials.find(function (record) { return record.id === id; });
      label = item ? item.name : "material package";
    } else if (type === "variation") {
      item = state.variations.find(function (record) { return record.id === id; });
      label = item ? item.id + " — " + item.title : "variation";
    } else if (type === "calendar") {
      item = state.calendarExceptions.find(function (record) { return record.id === id; });
      label = item ? item.name : "calendar exception";
    } else if (type === "task") {
      item = state.tasks.find(function (record) { return record.id === id; });
      label = item ? item.name : "task";
    }
    if (!item) {
      showFeedback("The selected record no longer exists.", "error");
      closeModal();
      return;
    }
    if (type === "task" && !item.userCreated) {
      showFeedback("Imported baseline tasks are protected and cannot be deleted.", "error");
      return;
    }
    if (type === "task") {
      const links = [
        state.dailyEntries.some(function (entry) { return entry.taskId === id; }),
        state.materials.some(function (material) { return material.taskIds.includes(id); }),
        state.variations.some(function (variation) { return variation.taskId === id; }),
        state.programmeDayValues.some(function (value) { return value.taskId === id; })
      ];
      if (links.some(Boolean)) {
        showFeedback("Remove this task's daily, programme, material and variation records before deleting it.", "error");
        return;
      }
    }
    const linkedVariationEntries = type === "variation"
      ? state.dailyEntries.filter(function (entry) { return entry.variationId === id; }).length
      : 0;
    const message = "Delete " + label + "? This cannot be undone inside the app." +
      (linkedVariationEntries
        ? " " + linkedVariationEntries + " linked daily entries will be returned to base scope."
        : "");
    if (!await confirmAction("Delete " + humanise(type), message, "Delete")) return;

    const saved = await commit({
      entityType: type,
      entityId: id,
      action: humanise(type) + " deleted",
      before: clone(item),
      after: null
    }, function (draft) {
      if (type === "daily") {
        draft.dailyEntries = draft.dailyEntries.filter(function (record) { return record.id !== id; });
      } else if (type === "material") {
        draft.materials = draft.materials.filter(function (record) { return record.id !== id; });
      } else if (type === "variation") {
        draft.variations = draft.variations.filter(function (record) { return record.id !== id; });
        draft.dailyEntries.forEach(function (entry) {
          if (entry.variationId === id) {
            entry.variationId = null;
            entry.variationStatus = "none";
          }
        });
        E.recalculateVariationAllocations(draft);
      } else if (type === "calendar") {
        draft.calendarExceptions = draft.calendarExceptions.filter(function (record) { return record.id !== id; });
      } else if (type === "task") {
        draft.tasks = draft.tasks.filter(function (record) { return record.id !== id; });
        draft.taskDependencies = draft.taskDependencies.filter(function (relation) {
          return relation[0] !== id && relation[1] !== id;
        });
      }
    }, { message: humanise(type) + " deleted." });
    if (saved) closeModal();
  }

  async function saveProgrammeCell(input) {
    const taskId = input.dataset.programmeTask;
    const date = input.dataset.programmeDate;
    const raw = input.value.trim();
    let manDayValue = null;
    if (raw !== "") manDayValue = numeric(raw, "Man-days", 0, 100);
    const before = state.programmeDayValues.find(function (value) {
      return value.taskId === taskId && value.date === date;
    });
    const scroll = document.getElementById("programme-scroll");
    ui.programmeScroll = scroll ? scroll.scrollLeft : 0;
    await commit({
      entityType: "programme-day",
      entityId: taskId + "|" + date,
      action: manDayValue === null ? "Programme override cleared" : "Programme man-days saved",
      before: before ? clone(before) : null
    }, function (draft) {
      draft.programmeDayValues = draft.programmeDayValues.filter(function (value) {
        return value.taskId !== taskId || value.date !== date;
      });
      if (manDayValue !== null) {
        draft.programmeDayValues.push({
          taskId,
          date,
          manDays: manDayValue,
          note: "Manual programme entry",
          updatedAt: new Date().toISOString()
        });
      }
    }, {
      message: manDayValue === null
        ? "Manual value cleared; automatic projection restored."
        : number(manDayValue, 2) + " man-days saved; later automatic dates recalculated."
    });
  }

  async function resetProgramme() {
    const today = derived.programme.today;
    const futureValues = state.programmeDayValues.filter(function (value) {
      return E.compareDates(value.date, today) > 0;
    });
    const overrides = state.tasks.filter(function (task) {
      return task.manualForecastRate !== null ||
        task.manualForecastStart !== null ||
        task.manualForecastFinish !== null;
    }).length;
    if (!futureValues.length && !overrides) {
      showFeedback("There are no future manual values or forecast overrides to reset.", "success");
      return;
    }
    const confirmed = await confirmAction(
      "Reset future programme values",
      "Remove " + futureValues.length + " manual values strictly after today (" +
        dateLabel(today) + ") and clear " + overrides +
        " task forecast overrides? History, today, actual progress, source allowances and approved variations will remain.",
      "Reset future values"
    );
    if (!confirmed) return;
    await commit({
      entityType: "programme",
      entityId: state.project.id,
      action: "Future programme values reset",
      before: { futureValues: futureValues.length, forecastOverrides: overrides }
    }, function (draft) {
      draft.programmeDayValues = draft.programmeDayValues.filter(function (value) {
        return E.compareDates(value.date, today) <= 0;
      });
      draft.tasks.forEach(function (task) {
        task.manualForecastRate = null;
        task.manualForecastStart = null;
        task.manualForecastFinish = null;
      });
    }, { message: "Future manual values cleared and default weekday projections restored." });
  }

  function csvRowsForRoute() {
    if (ui.route === "daily") {
      return [["ID", "Date", "Task", "Workfront", "Labour Hours", "Physical Quantity", "Unit", "Rework Hours", "Variation", "Delay", "Notes"]]
        .concat(state.dailyEntries.map(function (entry) {
          const task = state.tasks.find(function (item) { return item.id === entry.taskId; });
          return [
            entry.id, entry.date, task ? task.name : entry.taskId, entry.workfront,
            entry.labourHours, entry.unitsCompleted, task ? task.trackingUom : "",
            entry.reworkHours, entry.variationId || "", entry.delayReason || "", entry.notes || ""
          ];
        }));
    }
    if (ui.route === "programme") {
      return [["Task ID", "Task", "Work Package", "Target Start", "Target Finish"].concat(derived.programme.dates)]
        .concat(derived.programme.rows.map(function (row) {
          return [row.taskId, row.taskName, row.workPackage, row.targetStart, row.targetFinish]
            .concat(row.cells.map(function (cell) { return cell.manDays === null ? "" : cell.manDays; }));
        }));
    }
    if (ui.route === "materials") {
      return [["ID", "Package", "Component", "Supplier", "Task IDs", "Lead Working Days", "Buffer Working Days", "Required On Site", "Suggested Order", "PO Number", "PO Date", "Confirmed Delivery", "Status", "Critical", "Notes"]]
        .concat(state.materials.map(function (item) {
          return [
            item.id, item.name, item.component, item.supplier, item.taskIds.join(";"),
            item.leadTimeWorkingDays, item.bufferWorkingDays, item.requiredOnSiteDate,
            item.suggestedOrderDate, item.purchaseOrderNumber, item.purchaseOrderDate,
            item.confirmedDeliveryDate, item.status, item.critical, item.notes
          ];
        }));
    }
    if (ui.route === "variations") {
      return [["ID", "Title", "Task ID", "Status", "Submitted Hours", "Exposure Hours", "Approved Hours", "Approved Units", "Critical Path Impact", "Response Due", "Description"]]
        .concat(state.variations.map(function (item) {
          return [
            item.id, item.title, item.taskId, item.status, item.submittedHours,
            item.exposureHours, item.approvedHours, item.approvedUnits,
            item.criticalPathImpact, item.clientResponseDue, item.description
          ];
        }));
    }
    if (ui.route === "calendar") {
      return [["ID", "Reason", "Start Date", "End Date", "Treatment"]]
        .concat(state.calendarExceptions.map(function (item) {
          return [item.id, item.name, item.startDate, item.endDate, item.treatment];
        }));
    }
    if (ui.route === "checks") {
      return [["Severity", "Area", "Title", "Detail"]]
        .concat(derived.checks.map(function (check) {
          return [check.severity, check.area, check.title, check.detail];
        }));
    }
    if (ui.route === "audit") {
      return [["Timestamp", "Actor", "Entity Type", "Entity ID", "Action"]]
        .concat(state.auditEvents.map(function (event) {
          return [event.timestamp, event.actor, event.entityType, event.entityId, event.action];
        }));
    }
    const rows = [["Task ID", "Task", "Work Package", "Original Hours", "Revised Hours", "Actual Hours", "Earned Hours", "Forecast Hours", "Forecast Variance", "Forecast Finish", "Status"]];
    derived.metrics.forEach(function (metric) {
      rows.push([
        metric.task.id, metric.task.name, metric.task.workPackage,
        metric.task.originalBudgetHours, metric.revisedBudgetHours, metric.actualHours,
        metric.earnedHours, metric.forecastTotalHours, metric.forecastVariance,
        metric.displayedForecastFinish, metric.task.status
      ]);
    });
    return rows;
  }

  function exportCurrentCsv() {
    downloadText(
      safeFilename(state.project.name) + "-" + ui.route + "-" + E.nzToday() + ".csv",
      "\ufeff" + toCsv(csvRowsForRoute()),
      "text/csv;charset=utf-8"
    );
    showFeedback("Current " + ui.route + " data exported as CSV.", "success");
  }

  function exportProject() {
    const snapshot = clone(state);
    snapshot.exportedAt = new Date().toISOString();
    snapshot.application = {
      name: "Savannah Project Control",
      edition: "standalone",
      schemaVersion: 1
    };
    downloadText(
      safeFilename(state.project.name) + "-complete-backup-" + E.nzToday() + ".json",
      JSON.stringify(snapshot, null, 2),
      "application/json;charset=utf-8"
    );
    showFeedback("Complete project backup exported.", "success");
  }

  async function importProject(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      E.validateSnapshot(parsed);
      const confirmed = await confirmAction(
        "Replace active project",
        "Import " + parsed.project.name + "? This replaces the current local project and its audit history. Export the current project first if it must be retained.",
        "Import project"
      );
      if (!confirmed) return;
      delete parsed.application;
      state = await window.SPCDB.replace(parsed);
      derived = E.derive(state);
      ui.collapsedWeeks = null;
      render();
      showFeedback("Project backup imported and saved locally.", "success");
    } catch (error) {
      showFeedback(error instanceof Error ? error.message : "The project file could not be imported.", "error");
    } finally {
      document.getElementById("import-file").value = "";
    }
  }

  function routeFromHash() {
    const value = location.hash.replace(/^#\/?/, "").split("/")[0] || "overview";
    return routeNames.has(value) ? value : "overview";
  }

  function updateStorageStatus() {
    const storage = window.SPCDB.status();
    const badge = document.getElementById("storage-status");
    badge.textContent = storage.label;
    badge.className = "storage-badge " + (storage.mode === "memory" ? "risk" : "good");
    const warning = document.getElementById("storage-warning");
    warning.textContent = storage.warning;
    warning.hidden = storage.mode !== "memory";
  }

  function render() {
    ui.route = routeFromHash();
    derived = derived || E.derive(state);
    const meta = routeMeta[ui.route];
    document.getElementById("page-eyebrow").textContent = meta[0];
    document.getElementById("page-title").textContent = meta[1];
    document.getElementById("page-description").textContent = meta[2];
    document.getElementById("project-name").textContent = state.project.name;
    document.title = meta[1] + " · Savannah Project Control";
    document.querySelectorAll("#main-nav a").forEach(function (link) {
      const active = link.dataset.route === ui.route;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    const count = derived.checks.filter(function (check) {
      return check.severity !== "information";
    }).length;
    const countBadge = document.getElementById("check-count");
    countBadge.textContent = String(count);
    countBadge.hidden = count === 0;
    updateStorageStatus();

    const renderers = {
      overview: renderOverview,
      daily: renderDaily,
      programme: renderProgramme,
      materials: renderMaterials,
      variations: renderVariations,
      calendar: renderCalendar,
      checks: renderChecks,
      audit: renderAudit,
      setup: renderSetup
    };
    pageContent.setAttribute("aria-busy", "true");
    try {
      pageContent.innerHTML = renderers[ui.route]();
      if (ui.route === "programme") {
        window.requestAnimationFrame(function () {
          const scroll = document.getElementById("programme-scroll");
          if (scroll) scroll.scrollLeft = ui.programmeScroll;
        });
      }
    } catch (error) {
      pageContent.innerHTML =
        '<div class="empty-state error-state"><strong>This view could not be prepared.</strong><p>' +
        escapeHtml(error instanceof Error ? error.message : "Unknown error") + "</p></div>";
    } finally {
      pageContent.setAttribute("aria-busy", "false");
    }
  }

  async function resetDemo() {
    const confirmed = await confirmAction(
      "Restore demonstration project",
      "Replace the active local project with the original fictional demonstration data? Current changes and audit history will be removed.",
      "Restore demo"
    );
    if (!confirmed) return;
    state = await window.SPCDB.replace(window.SPCData.createDefault());
    derived = E.derive(state);
    ui.collapsedWeeks = null;
    render();
    showFeedback("Demonstration data restored.", "success");
  }

  async function handleAction(button) {
    const action = button.dataset.action;
    if (action === "open-record") {
      openRecord(button.dataset.recordType, button.dataset.recordId);
    } else if (action === "close-modal") {
      closeModal();
    } else if (action === "delete-record") {
      await deleteRecord(button.dataset.recordType, button.dataset.recordId);
    } else if (action === "go-route") {
      location.hash = button.dataset.route || "overview";
    } else if (action === "reset-programme") {
      await resetProgramme();
    } else if (action === "programme-view") {
      ui.programmeView = button.dataset.view;
      const scroll = document.getElementById("programme-scroll");
      ui.programmeScroll = scroll ? scroll.scrollLeft : 0;
      render();
    } else if (action === "toggle-week") {
      const key = button.dataset.week;
      if (ui.collapsedWeeks.has(key)) ui.collapsedWeeks.delete(key);
      else ui.collapsedWeeks.add(key);
      const scroll = document.getElementById("programme-scroll");
      ui.programmeScroll = scroll ? scroll.scrollLeft : 0;
      render();
    } else if (action === "toggle-past-all") {
      const weeks = buildWeeks(derived.programme.dates, derived.programme.today)
        .filter(function (week) { return week.isPast; });
      const allCollapsed = weeks.every(function (week) {
        return ui.collapsedWeeks.has(week.key);
      });
      weeks.forEach(function (week) {
        if (allCollapsed) ui.collapsedWeeks.delete(week.key);
        else ui.collapsedWeeks.add(week.key);
      });
      render();
    } else if (action === "export-project") {
      exportProject();
    } else if (action === "trigger-import") {
      document.getElementById("import-file").click();
    } else if (action === "reset-demo") {
      await resetDemo();
    }
  }

  function installEvents() {
    window.addEventListener("hashchange", function () {
      render();
      document.getElementById("workspace").focus({ preventScroll: true });
      document.getElementById("sidebar").classList.remove("open");
      document.getElementById("menu-toggle").setAttribute("aria-expanded", "false");
    });

    pageContent.addEventListener("submit", function (event) {
      const form = event.target.closest("form[data-form]");
      if (!form) return;
      event.preventDefault();
      handleForm(form);
    });
    modalBody.addEventListener("submit", function (event) {
      const form = event.target.closest("form[data-form]");
      if (!form) return;
      event.preventDefault();
      handleForm(form);
    });

    document.addEventListener("click", function (event) {
      const button = event.target.closest("[data-action]");
      if (button) handleAction(button);
    });

    pageContent.addEventListener("change", function (event) {
      const input = event.target;
      if (input.matches("[data-programme-task]")) {
        saveProgrammeCell(input);
        return;
      }
      const control = input.dataset.programmeControl;
      if (!control) return;
      const scroll = document.getElementById("programme-scroll");
      ui.programmeScroll = scroll ? scroll.scrollLeft : 0;
      if (control === "package") ui.programmePackage = input.value;
      if (control === "completed") ui.programmeShowCompleted = input.checked;
      if (control === "demand") ui.programmeShowDemand = input.checked;
      if (control === "overlays") ui.programmeShowOverlays = input.checked;
      render();
    });

    pageContent.addEventListener("keydown", function (event) {
      if (!event.target.matches("[data-programme-task]")) return;
      if (event.key === "Enter") {
        event.preventDefault();
        event.target.blur();
      }
      if (event.key === "Escape") {
        event.target.value = "";
        event.target.blur();
      }
    });

    document.getElementById("modal-close").addEventListener("click", closeModal);
    itemDialog.addEventListener("click", function (event) {
      if (event.target === itemDialog) closeModal();
    });
    document.getElementById("menu-toggle").addEventListener("click", function () {
      const sidebar = document.getElementById("sidebar");
      const open = sidebar.classList.toggle("open");
      this.setAttribute("aria-expanded", String(open));
    });
    document.getElementById("master-export").addEventListener("click", exportProject);
    document.getElementById("import-project").addEventListener("click", function () {
      document.getElementById("import-file").click();
    });
    document.getElementById("import-file").addEventListener("change", function () {
      importProject(this.files && this.files[0]);
    });
    document.getElementById("page-csv").addEventListener("click", exportCurrentCsv);
    document.getElementById("page-print").addEventListener("click", function () {
      document.body.dataset.printRoute = ui.route;
      window.print();
    });
  }

  async function initialise() {
    installEvents();
    const fallback = window.SPCData.createDefault();
    try {
      state = await window.SPCDB.initialise(fallback);
      E.validateSnapshot(state);
    } catch (error) {
      state = await window.SPCDB.replace(fallback);
      showFeedback(
        "The saved local project was invalid, so the demonstration project was restored. " +
          (error instanceof Error ? error.message : ""),
        "error"
      );
    }
    derived = E.derive(state);
    render();
  }

  initialise();
})();
