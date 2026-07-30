(function (root) {
  "use strict";

  const DAY_MS = 86400000;
  const EPSILON = 1e-9;

  function round(value, places) {
    const precision = places === undefined ? 2 : places;
    const factor = 10 ** precision;
    return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
  }

  function parseDate(value) {
    const date = new Date(String(value) + "T00:00:00Z");
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new Error("Invalid date: " + value);
    }
    return date;
  }

  function formatDate(date) {
    return date.toISOString().slice(0, 10);
  }

  function compareDates(a, b) {
    return parseDate(a).getTime() - parseDate(b).getTime();
  }

  function addCalendarDays(value, days) {
    const date = parseDate(value);
    date.setUTCDate(date.getUTCDate() + Number(days));
    return formatDate(date);
  }

  function dateRangeInclusive(start, finish) {
    if (compareDates(finish, start) < 0) return [];
    const dates = [];
    let cursor = start;
    while (compareDates(cursor, finish) <= 0) {
      dates.push(cursor);
      cursor = addCalendarDays(cursor, 1);
    }
    return dates;
  }

  function maxDate() {
    const values = Array.from(arguments).flat().filter(Boolean);
    if (!values.length) throw new Error("At least one date is required.");
    return values.reduce(function (latest, value) {
      return compareDates(value, latest) > 0 ? value : latest;
    });
  }

  function minDate() {
    const values = Array.from(arguments).flat().filter(Boolean);
    if (!values.length) throw new Error("At least one date is required.");
    return values.reduce(function (earliest, value) {
      return compareDates(value, earliest) < 0 ? value : earliest;
    });
  }

  function startOfIsoWeek(value) {
    const day = parseDate(value).getUTCDay();
    return addCalendarDays(value, -(day === 0 ? 6 : day - 1));
  }

  function endOfIsoWeek(value) {
    return addCalendarDays(startOfIsoWeek(value), 6);
  }

  function nzToday(now) {
    const parts = new Intl.DateTimeFormat("en-NZ", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "Pacific/Auckland"
    }).formatToParts(now || new Date());
    const get = function (type) {
      const part = parts.find(function (item) {
        return item.type === type;
      });
      return part && part.value;
    };
    return get("year") + "-" + get("month") + "-" + get("day");
  }

  function buildExceptionSet(state) {
    const values = new Set();
    (state.calendarExceptions || []).forEach(function (item) {
      dateRangeInclusive(item.startDate, item.endDate).forEach(function (date) {
        values.add(date);
      });
    });
    return values;
  }

  function isWorkingDay(value, exceptionDates, workingWeek) {
    const day = parseDate(value).getUTCDay();
    const workingDays = workingWeek || [1, 2, 3, 4, 5];
    return workingDays.includes(day) && !exceptionDates.has(value);
  }

  function nextWorkingDay(value, exceptions, workingWeek) {
    let cursor = addCalendarDays(value, 1);
    while (!isWorkingDay(cursor, exceptions, workingWeek)) {
      cursor = addCalendarDays(cursor, 1);
    }
    return cursor;
  }

  function onOrNextWorkingDay(value, exceptions, workingWeek) {
    let cursor = value;
    while (!isWorkingDay(cursor, exceptions, workingWeek)) {
      cursor = addCalendarDays(cursor, 1);
    }
    return cursor;
  }

  function addWorkingDays(value, days, exceptions, workingWeek) {
    if (days <= 0) return value;
    let cursor = value;
    let remaining = days;
    while (remaining > 0) {
      cursor = addCalendarDays(cursor, 1);
      if (isWorkingDay(cursor, exceptions, workingWeek)) remaining -= 1;
    }
    return cursor;
  }

  function subtractWorkingDays(value, days, exceptions, workingWeek) {
    if (days <= 0) return value;
    let cursor = value;
    let remaining = days;
    while (remaining > 0) {
      cursor = addCalendarDays(cursor, -1);
      if (isWorkingDay(cursor, exceptions, workingWeek)) remaining -= 1;
    }
    return cursor;
  }

  function workingDaysInclusive(start, finish, exceptions, workingWeek) {
    if (compareDates(finish, start) < 0) return 0;
    let total = 0;
    dateRangeInclusive(start, finish).forEach(function (date) {
      if (isWorkingDay(date, exceptions, workingWeek)) total += 1;
    });
    return total;
  }

  function shortDate(value) {
    return new Intl.DateTimeFormat("en-NZ", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC"
    }).format(parseDate(value));
  }

  function key(taskId, date) {
    return taskId + "|" + date;
  }

  function approvedDailyManDays(entries, hoursPerManDay) {
    const totals = new Map();
    entries.forEach(function (entry) {
      if (entry.variationStatus !== "none" && entry.variationStatus !== "approved") return;
      const entryKey = key(entry.taskId, entry.date);
      totals.set(entryKey, (totals.get(entryKey) || 0) + entry.labourHours / hoursPerManDay);
    });
    return totals;
  }

  function programmeEntriesForMetrics(state) {
    const project = state.project;
    const applicable = new Map();
    (state.programmeDayValues || []).forEach(function (value) {
      if (compareDates(value.date, project.statusDate) <= 0) {
        applicable.set(key(value.taskId, value.date), value);
      }
    });
    if (!applicable.size) return state.dailyEntries.slice();

    const retained = [];
    const progress = new Map();
    state.dailyEntries.forEach(function (entry) {
      const entryKey = key(entry.taskId, entry.date);
      const override = applicable.get(entryKey);
      const approvedBase = entry.variationStatus === "none" || entry.variationStatus === "approved";
      if (!override || !approvedBase) {
        retained.push(entry);
        return;
      }
      const current = progress.get(entryKey) || {
        units: 0,
        reworkHours: 0,
        delayReason: null
      };
      current.units += Number(entry.unitsCompleted || 0);
      current.reworkHours += Number(entry.reworkHours || 0);
      current.delayReason = current.delayReason || entry.delayReason || null;
      progress.set(entryKey, current);
    });

    applicable.forEach(function (override, entryKey) {
      const captured = progress.get(entryKey);
      const hours = override.manDays * project.productiveHoursPerPerson;
      retained.push({
        id: "PROGRAMME-" + override.taskId + "-" + override.date,
        taskId: override.taskId,
        date: override.date,
        labourHours: round(hours, 4),
        unitsCompleted: captured ? captured.units : 0,
        reworkHours: Math.min(captured ? captured.reworkHours : 0, hours),
        variationStatus: "none",
        variationId: null,
        delayReason: captured ? captured.delayReason : null,
        workfront: "Programme grid",
        notes: override.note || ""
      });
    });
    return retained;
  }

  function calculateTaskMetric(options) {
    const project = options.project;
    const task = options.task;
    const entries = options.entries;
    const materials = options.materials;
    const exceptionDates = options.exceptionDates;
    const predecessorFinishDates = options.predecessorFinishDates || [];
    const workingWeek = project.workingWeek;
    const revisedUnits = task.originalUnits + task.approvedVariationUnits;
    const revisedBudgetHours = task.originalBudgetHours + task.approvedVariationHours;

    const toStatus = entries.filter(function (entry) {
      return entry.taskId === task.id && compareDates(entry.date, project.statusDate) <= 0;
    });
    const approvedEntries = toStatus.filter(function (entry) {
      return entry.variationStatus === "none" || entry.variationStatus === "approved";
    });
    const atRiskEntries = toStatus.filter(function (entry) {
      return entry.variationStatus === "at-risk" || entry.variationStatus === "rejected";
    });
    const sum = function (items, field) {
      return items.reduce(function (total, item) {
        return total + Number(item[field] || 0);
      }, 0);
    };
    const actualHours = sum(approvedEntries, "labourHours");
    const atRiskHours = sum(atRiskEntries, "labourHours");
    const completedUnits = sum(approvedEntries, "unitsCompleted");
    const cappedCompletedUnits = Math.min(completedUnits, revisedUnits);
    const progressPercent = revisedUnits > 0 ? cappedCompletedUnits / revisedUnits : 0;
    const budgetHoursPerUnit = revisedUnits > 0 ? revisedBudgetHours / revisedUnits : 0;
    const earnedHours = cappedCompletedUnits * budgetHoursPerUnit;
    const productivityVariance = earnedHours - actualHours;

    let forecastBasis = "budget-rate";
    let selectedForecastHoursPerUnit = budgetHoursPerUnit;
    if (task.manualForecastRate !== null && Number(task.manualForecastRate) > 0) {
      forecastBasis = "manual";
      selectedForecastHoursPerUnit = Number(task.manualForecastRate);
    } else if (
      (
        progressPercent + EPSILON >= project.minimumProgressPercent ||
        cappedCompletedUnits + EPSILON >= project.minimumProgressUnits
      ) &&
      cappedCompletedUnits > 0
    ) {
      forecastBasis = "actual-to-date";
      selectedForecastHoursPerUnit = actualHours / cappedCompletedUnits;
    }

    const remainingUnits = Math.max(0, revisedUnits - cappedCompletedUnits);
    const forecastRemainingHours = remainingUnits * selectedForecastHoursPerUnit;
    const forecastTotalHours = actualHours + forecastRemainingHours;
    const forecastVariance = revisedBudgetHours - forecastTotalHours;

    const materialDates = materials
      .filter(function (material) {
        return (
          material.taskIds.includes(task.id) &&
          material.status !== "delivered" &&
          material.status !== "complete"
        );
      })
      .map(function (material) {
        return material.confirmedDeliveryDate ||
          material.forecastNeedDate ||
          material.requiredOnSiteDate;
      })
      .filter(Boolean);

    const defaultForecastStart = onOrNextWorkingDay(
      maxDate(
        nextWorkingDay(project.statusDate, exceptionDates, workingWeek),
        task.targetStart,
        task.accessDate,
        predecessorFinishDates,
        materialDates
      ),
      exceptionDates,
      workingWeek
    );
    const displayedForecastStart = task.manualForecastStart || defaultForecastStart;
    const assignedCapacity = task.assignedStaff * project.productiveHoursPerPerson;
    const forecastWorkingDays =
      forecastRemainingHours <= 0
        ? 0
        : assignedCapacity > 0
          ? Math.ceil(forecastRemainingHours / assignedCapacity)
          : 0;
    const defaultForecastFinish =
      forecastRemainingHours <= 0
        ? project.statusDate
        : assignedCapacity > 0
          ? addWorkingDays(
              displayedForecastStart,
              Math.max(0, forecastWorkingDays - 1),
              exceptionDates,
              workingWeek
            )
          : displayedForecastStart;
    const displayedForecastFinish = task.manualForecastFinish || defaultForecastFinish;
    const remainingWorkingDays = workingDaysInclusive(
      displayedForecastStart,
      task.targetFinish,
      exceptionDates,
      workingWeek
    );
    const requiredStaffFte =
      forecastRemainingHours <= 0
        ? 0
        : remainingWorkingDays > 0
          ? forecastRemainingHours / remainingWorkingDays / project.productiveHoursPerPerson
          : Number.POSITIVE_INFINITY;
    const recommendedStaff = Number.isFinite(requiredStaffFte) ? Math.ceil(requiredStaffFte) : 0;

    const flags = [];
    if (actualHours > 0 && completedUnits === 0) flags.push("Hours recorded with no measured progress");
    if (completedUnits > revisedUnits + EPSILON) flags.push("Completed units exceed the approved total");
    if (task.assignedStaff <= 0 && forecastRemainingHours > 0) flags.push("No crew is assigned");
    if (task.maxPracticalCrew !== null && requiredStaffFte > task.maxPracticalCrew) {
      flags.push("Recovery is not achievable through labour alone");
    }
    if (compareDates(displayedForecastFinish, task.targetFinish) > 0) {
      flags.push("Forecast finish is after the target");
    }
    if (task.criticality === "unknown") flags.push("Criticality is not confirmed");

    const varianceRatio = revisedBudgetHours > 0 ? productivityVariance / revisedBudgetHours : 0;
    let health = "good";
    if (
      flags.some(function (flag) {
        return flag.includes("after the target") ||
          flag.includes("not achievable") ||
          flag.includes("exceed");
      }) ||
      varianceRatio < -0.1
    ) {
      health = "risk";
    } else if (flags.length || varianceRatio < -0.03) {
      health = "watch";
    }

    return {
      task,
      revisedUnits: round(revisedUnits, 4),
      revisedBudgetHours: round(revisedBudgetHours, 4),
      actualHours: round(actualHours, 4),
      atRiskHours: round(atRiskHours, 4),
      completedUnits: round(completedUnits, 4),
      progressPercent: round(progressPercent, 4),
      earnedHours: round(earnedHours, 4),
      productivityVariance: round(productivityVariance, 4),
      selectedForecastHoursPerUnit: round(selectedForecastHoursPerUnit, 4),
      forecastBasis,
      forecastRemainingHours: round(forecastRemainingHours, 4),
      forecastTotalHours: round(forecastTotalHours, 4),
      forecastVariance: round(forecastVariance, 4),
      requiredStaffFte: Number.isFinite(requiredStaffFte) ? round(requiredStaffFte, 2) : null,
      recommendedStaff,
      defaultForecastStart,
      defaultForecastFinish,
      displayedForecastStart,
      displayedForecastFinish,
      health,
      flags
    };
  }

  function calculateMetrics(state, exceptionDates) {
    const entries = programmeEntriesForMetrics(state);
    const metricsByTask = new Map();
    return state.tasks.map(function (task) {
      const predecessors = (state.taskDependencies || [])
        .filter(function (relation) {
          return relation[0] === task.id;
        })
        .map(function (relation) {
          const metric = metricsByTask.get(relation[1]);
          return metric && metric.displayedForecastFinish;
        })
        .filter(Boolean);
      const metric = calculateTaskMetric({
        project: state.project,
        task,
        entries,
        materials: state.materials,
        exceptionDates,
        predecessorFinishDates: predecessors
      });
      metricsByTask.set(task.id, metric);
      return metric;
    });
  }

  function buildProgrammeState(state, metrics, exceptionDates, today) {
    const project = state.project;
    const values = state.programmeDayValues || [];
    const metricByTask = new Map(metrics.map(function (metric) {
      return [metric.task.id, metric];
    }));
    const manualByCell = new Map(values.map(function (value) {
      return [key(value.taskId, value.date), value];
    }));
    const actualByCell = approvedDailyManDays(state.dailyEntries, project.productiveHoursPerPerson);
    const startDate = minDate(
      project.originalStart,
      state.tasks.flatMap(function (task) {
        return [task.originalStart, task.targetStart];
      })
    );
    const finishDate = maxDate(
      project.targetFinish,
      state.tasks.flatMap(function (task) {
        return [task.targetFinish, task.originalFinish];
      }),
      metrics.map(function (metric) {
        return metric.displayedForecastFinish;
      }),
      values.map(function (value) {
        return value.date;
      })
    );
    const dates = dateRangeInclusive(startDate, finishDate);
    const projectionPivot = compareDates(project.statusDate, today) > 0
      ? project.statusDate
      : today;

    const rows = state.tasks.map(function (task) {
      const metric = metricByTask.get(task.id);
      const taskValues = values.filter(function (value) {
        return value.taskId === task.id;
      });
      const latestManualDate = taskValues.length
        ? maxDate(taskValues.map(function (value) {
            return value.date;
          }))
        : null;
      const revisedManDays = Math.ceil(metric.revisedBudgetHours / project.productiveHoursPerPerson);
      const fixedByDate = new Map();
      dates.forEach(function (date) {
        const manual = manualByCell.get(key(task.id, date));
        if (manual) {
          fixedByDate.set(date, manual.manDays);
        } else if (compareDates(date, project.statusDate) <= 0) {
          const actual = actualByCell.get(key(task.id, date));
          if (actual !== undefined) fixedByDate.set(date, actual);
        }
      });
      const fixedManDays = Array.from(fixedByDate.values()).reduce(function (total, value) {
        return total + value;
      }, 0);
      const remainingManDays = Math.max(0, revisedManDays - fixedManDays);
      const start = maxDate(
        addCalendarDays(projectionPivot, 1),
        task.targetStart,
        metric.defaultForecastStart
      );
      const projectionEnabled = !["complete", "cancelled", "on-hold"].includes(task.status);
      let allocatedThroughDate = 0;

      const cells = dates.map(function (date) {
        const manual = manualByCell.get(key(task.id, date));
        if (manual) {
          allocatedThroughDate += manual.manDays;
          return {
            date,
            manDays: round(manual.manDays, 2),
            kind: compareDates(date, project.statusDate) <= 0 ? "actual" : "manual",
            editable: true,
            note: manual.note || ""
          };
        }
        const actual = actualByCell.get(key(task.id, date));
        if (actual !== undefined && compareDates(date, project.statusDate) <= 0) {
          allocatedThroughDate += actual;
          return {
            date,
            manDays: round(actual, 2),
            kind: "actual",
            editable: true
          };
        }

        const automatic =
          projectionEnabled &&
          compareDates(date, start) >= 0 &&
          compareDates(date, task.targetFinish) <= 0 &&
          isWorkingDay(date, exceptionDates, project.workingWeek);
        if (automatic && allocatedThroughDate < revisedManDays) {
          const remainingWorkingDays = dates.filter(function (candidate) {
            return (
              compareDates(candidate, date) >= 0 &&
              compareDates(candidate, task.targetFinish) <= 0 &&
              isWorkingDay(candidate, exceptionDates, project.workingWeek)
            );
          }).length;
          const projected = remainingWorkingDays
            ? Math.max(0, round((revisedManDays - allocatedThroughDate) / remainingWorkingDays, 2))
            : 0;
          if (projected > 0) {
            allocatedThroughDate += projected;
            return { date, manDays: projected, kind: "projected", editable: true };
          }
        }

        const day = parseDate(date).getUTCDay();
        if (!project.workingWeek.includes(day)) {
          return { date, manDays: null, kind: "weekend", editable: true };
        }
        if (exceptionDates.has(date)) {
          return { date, manDays: null, kind: "exception", editable: true };
        }
        return { date, manDays: null, kind: "blank", editable: true };
      });

      const scheduledManDays = cells.reduce(function (total, cell) {
        return total + (cell.manDays || 0);
      }, 0);
      const scheduledByDueDate = cells
        .filter(function (cell) {
          return compareDates(cell.date, task.targetFinish) <= 0;
        })
        .reduce(function (total, cell) {
          return total + (cell.manDays || 0);
        }, 0);
      const planningPivot =
        latestManualDate && compareDates(latestManualDate, projectionPivot) > 0
          ? latestManualDate
          : projectionPivot;
      const nextAutomatic = cells.find(function (cell) {
        return cell.kind === "projected" && compareDates(cell.date, planningPivot) > 0;
      });
      const required = nextAutomatic
        ? nextAutomatic.manDays
        : scheduledByDueDate + 0.01 < revisedManDays
          ? Number.POSITIVE_INFINITY
          : 0;
      const allocationVarianceManDays = round(scheduledManDays - revisedManDays, 2);
      let feasibility = "achievable";
      if (allocationVarianceManDays > 0.01) feasibility = "over-allocated";
      else if (remainingManDays <= 0) feasibility = "complete";
      else if (
        !Number.isFinite(required) ||
        (task.maxPracticalCrew !== null && required > task.maxPracticalCrew)
      ) feasibility = "not-achievable";
      else if (required > task.assignedStaff) feasibility = "needs-crew";

      return {
        taskId: task.id,
        taskName: task.name,
        workPackage: task.workPackage,
        status: task.status,
        targetStart: task.targetStart,
        targetFinish: task.targetFinish,
        forecastStart: metric.displayedForecastStart,
        forecastFinish: metric.displayedForecastFinish,
        revisedManDays: round(revisedManDays, 2),
        fixedManDays: round(fixedManDays, 2),
        remainingManDays: round(remainingManDays, 2),
        scheduledManDays: round(scheduledManDays, 2),
        allocationVarianceManDays,
        requiredManDaysPerWorkingDay: Number.isFinite(required) ? round(required, 2) : required,
        assignedCrew: task.assignedStaff,
        maxPracticalCrew: task.maxPracticalCrew,
        feasibility,
        latestManualDate,
        cells
      };
    });

    return {
      today,
      startDate,
      finishDate,
      dates,
      rows,
      dailyDemand: dates.map(function (date) {
        return {
          date,
          manDays: round(rows.reduce(function (total, row) {
            const cell = row.cells.find(function (item) {
              return item.date === date;
            });
            return total + (cell && cell.manDays ? cell.manDays : 0);
          }, 0), 2)
        };
      })
    };
  }

  function aggregateMetrics(metrics) {
    return metrics.reduce(function (summary, metric) {
      summary.revisedBudgetHours += metric.revisedBudgetHours;
      summary.actualHours += metric.actualHours;
      summary.earnedHours += metric.earnedHours;
      summary.productivityVariance += metric.productivityVariance;
      summary.forecastTotalHours += metric.forecastTotalHours;
      summary.forecastVariance += metric.forecastVariance;
      summary.atRiskHours += metric.atRiskHours;
      return summary;
    }, {
      revisedBudgetHours: 0,
      actualHours: 0,
      earnedHours: 0,
      productivityVariance: 0,
      forecastTotalHours: 0,
      forecastVariance: 0,
      atRiskHours: 0
    });
  }

  function createChecks(state, metrics, programme) {
    const checks = [];
    const add = function (severity, area, title, detail, route, id) {
      checks.push({ id, severity, area, title, detail, route });
    };
    const originalHours = state.tasks
      .filter(function (task) { return !task.userCreated; })
      .reduce(function (total, task) {
        return total + task.originalBudgetHours;
      }, 0);
    const protectedTotal = Number(state.project.protectedBaselineHours || 0);
    if (protectedTotal > 0 && Math.abs(originalHours - protectedTotal) > 0.005) {
      add(
        "critical",
        "costing",
        "Imported hours no longer reconcile",
        "Task baseline is " + originalHours.toFixed(4) +
          " h; protected source total is " + protectedTotal.toFixed(4) + " h.",
        "setup",
        "costing-reconciliation"
      );
    }

    state.tasks.forEach(function (task) {
      if (compareDates(task.targetFinish, task.targetStart) < 0) {
        add("critical", "setup", task.name, "Target finish is before target start.", "setup", "task-dates-" + task.id);
      }
    });

    state.dailyEntries.forEach(function (entry) {
      if (entry.labourHours > 0 && entry.unitsCompleted === 0) {
        add(
          entry.delayReason ? "information" : "warning",
          "daily",
          "Hours recorded without measured progress",
          entry.labourHours.toFixed(1) + " h on " + shortDate(entry.date) +
            (entry.delayReason ? "; reason: " + entry.delayReason : "."),
          "daily",
          "entry-hours-" + entry.id
        );
      }
      if (entry.labourHours === 0 && entry.unitsCompleted > 0) {
        add(
          "warning",
          "daily",
          "Progress recorded without labour hours",
          entry.unitsCompleted + " physical units on " + shortDate(entry.date) + ".",
          "daily",
          "entry-units-" + entry.id
        );
      }
    });

    metrics.forEach(function (metric) {
      metric.flags.forEach(function (flag, index) {
        const critical =
          flag.includes("after the target") ||
          flag.includes("not achievable") ||
          flag.includes("exceed");
        add(
          critical ? "critical" : "warning",
          "programme",
          metric.task.name,
          flag,
          "programme",
          "metric-" + metric.task.id + "-" + index
        );
      });
    });

    programme.rows.forEach(function (row) {
      if (row.feasibility === "over-allocated") {
        add(
          "warning",
          "programme",
          row.taskName + " is over-allocated",
          Math.abs(row.allocationVarianceManDays).toFixed(2) + " excess man-days are scheduled.",
          "programme",
          "allocation-" + row.taskId
        );
      } else if (row.feasibility === "not-achievable") {
        add(
          "critical",
          "programme",
          row.taskName + " cannot meet its current target",
          "Remaining allowance cannot be spread across the available working days and practical crew.",
          "programme",
          "feasibility-" + row.taskId
        );
      }
    });

    state.materials.forEach(function (material) {
      if (!material.taskIds.length || !material.requiredOnSiteDate) {
        add(
          material.critical ? "critical" : "warning",
          "materials",
          material.name + " needs setup",
          (!material.taskIds.length ? "Link a controlling task. " : "") +
            (!material.requiredOnSiteDate ? "Enter the required-on-site date." : ""),
          "materials",
          "material-setup-" + material.id
        );
      }
      if (
        !material.purchaseOrderDate &&
        material.suggestedOrderDate &&
        compareDates(material.suggestedOrderDate, state.project.statusDate) <= 0
      ) {
        add(
          material.critical ? "critical" : "warning",
          "materials",
          material.name + " is not ordered",
          "Suggested order date was " + shortDate(material.suggestedOrderDate) + ".",
          "materials",
          "material-order-" + material.id
        );
      }
      if (
        material.confirmedDeliveryDate &&
        material.requiredOnSiteDate &&
        compareDates(material.confirmedDeliveryDate, material.requiredOnSiteDate) > 0
      ) {
        add(
          material.critical ? "critical" : "warning",
          "materials",
          material.name + " delivery is late",
          "Confirmed " + shortDate(material.confirmedDeliveryDate) +
            "; target need is " + shortDate(material.requiredOnSiteDate) + ".",
          "materials",
          "material-delivery-" + material.id
        );
      }
    });

    state.variations.forEach(function (variation) {
      if (
        variation.clientResponseDue &&
        compareDates(variation.clientResponseDue, state.project.statusDate) < 0 &&
        !["approved", "rejected", "closed", "paid"].includes(variation.status)
      ) {
        add(
          "warning",
          "variations",
          variation.id + " response is overdue",
          variation.title + "; response was due " + shortDate(variation.clientResponseDue) + ".",
          "variations",
          "variation-due-" + variation.id
        );
      }
    });

    const rank = { critical: 0, warning: 1, information: 2 };
    return checks.sort(function (a, b) {
      return rank[a.severity] - rank[b.severity] || a.title.localeCompare(b.title);
    });
  }

  function recalculateVariationAllocations(state) {
    const byTask = new Map();
    state.variations.forEach(function (variation) {
      if (!variation.taskId || !["approved", "partially-approved"].includes(variation.status)) return;
      const current = byTask.get(variation.taskId) || { hours: 0, units: 0 };
      current.hours += Number(variation.approvedHours || 0);
      current.units += Number(variation.approvedUnits || 0);
      byTask.set(variation.taskId, current);
    });
    state.tasks.forEach(function (task) {
      const allocation = byTask.get(task.id) || { hours: 0, units: 0 };
      task.approvedVariationHours = round(allocation.hours, 4);
      task.approvedVariationUnits = round(allocation.units, 4);
    });
  }

  function updateMaterialOrderDates(state) {
    const exceptions = buildExceptionSet(state);
    state.materials.forEach(function (material) {
      if (!material.requiredOnSiteDate) {
        material.suggestedOrderDate = null;
        return;
      }
      const totalDays =
        Number(material.leadTimeWorkingDays || 0) +
        Number(material.bufferWorkingDays || 0);
      material.suggestedOrderDate = subtractWorkingDays(
        material.requiredOnSiteDate,
        totalDays,
        exceptions,
        state.project.workingWeek
      );
    });
  }

  function derive(state, today) {
    recalculateVariationAllocations(state);
    updateMaterialOrderDates(state);
    const exceptionDates = buildExceptionSet(state);
    const metrics = calculateMetrics(state, exceptionDates);
    const resolvedToday = today || nzToday();
    const programme = buildProgrammeState(state, metrics, exceptionDates, resolvedToday);
    return {
      metrics,
      programme,
      checks: createChecks(state, metrics, programme),
      summary: aggregateMetrics(metrics),
      exceptionDates
    };
  }

  function validateSnapshot(value) {
    if (!value || typeof value !== "object") throw new Error("The project file is not valid JSON data.");
    if (value.schemaVersion !== 1) throw new Error("This project file uses an unsupported schema version.");
    if (!value.project || !Array.isArray(value.tasks)) throw new Error("Project settings or tasks are missing.");
    [
      "dailyEntries",
      "programmeDayValues",
      "materials",
      "variations",
      "calendarExceptions",
      "auditEvents"
    ].forEach(function (field) {
      if (!Array.isArray(value[field])) throw new Error("Project field '" + field + "' is missing.");
    });
    parseDate(value.project.statusDate);
    parseDate(value.project.originalStart);
    parseDate(value.project.targetFinish);
    if (!Number.isFinite(Number(value.project.productiveHoursPerPerson)) ||
        Number(value.project.productiveHoursPerPerson) <= 0) {
      throw new Error("Hours in one man-day must be greater than zero.");
    }
    value.tasks.forEach(function (task) {
      if (!task.id || !task.name) throw new Error("Every task requires an ID and name.");
      parseDate(task.targetStart);
      parseDate(task.targetFinish);
    });
    return true;
  }

  const api = {
    EPSILON,
    round,
    parseDate,
    formatDate,
    compareDates,
    addCalendarDays,
    dateRangeInclusive,
    maxDate,
    minDate,
    startOfIsoWeek,
    endOfIsoWeek,
    nzToday,
    buildExceptionSet,
    isWorkingDay,
    nextWorkingDay,
    onOrNextWorkingDay,
    addWorkingDays,
    subtractWorkingDays,
    workingDaysInclusive,
    shortDate,
    calculateTaskMetric,
    calculateMetrics,
    buildProgrammeState,
    aggregateMetrics,
    recalculateVariationAllocations,
    updateMaterialOrderDates,
    createChecks,
    derive,
    validateSnapshot
  };

  root.SPCEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
