export function validDay(s) {
  return (
    typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !isNaN(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s
  );
}
export function day(value, timeZone) {
  if (
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(
      value || "",
    ) ||
    !validDay(value.slice(0, 10)) ||
    isNaN(Date.parse(value))
  )
    return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
function dedupe(rows) {
  const byId = new Map(),
    conflicts = new Set();
  let duplicates = 0,
    invalid = 0;
  for (const row of rows) {
    if (!row.id?.trim() || !row.participant?.trim()) {
      invalid++;
      continue;
    }
    const normalized = JSON.stringify(
      Object.keys(row)
        .sort()
        .map((k) => [k, row[k]]),
    );
    if (byId.has(row.id)) {
      duplicates++;
      if (byId.get(row.id).normalized !== normalized) conflicts.add(row.id);
    } else byId.set(row.id, { row, normalized });
  }
  return {
    rows: [...byId].filter(([id]) => !conflicts.has(id)).map(([, v]) => v.row),
    duplicates,
    invalid,
    conflicts: conflicts.size,
  };
}
export function aggregate(source, filters = {}) {
  const { from = "", to = "", eventDate = "", category = "" } = filters;
  if (
    (from && !validDay(from)) ||
    (to && !validDay(to)) ||
    (eventDate && !validDay(eventDate)) ||
    (from && to && from > to)
  )
    throw new Error("INVALID_FILTER");
  const inRange = (d) => d && (!from || d >= from) && (!to || d <= to);
  const reg = dedupe(source.registrations),
    res = dedupe(source.results);
  let invalidDates = 0;
  const registrations = reg.rows.filter((r) => {
    if (!day(r.registeredAt, source.timeZone) || !validDay(r.eventDate)) {
      invalidDates++;
      return false;
    }
    return !category || r.category === category;
  });
  const period = registrations.filter((r) =>
    inRange(day(r.registeredAt, source.timeZone)),
  );
  const selected = period.filter(
    (r) => !eventDate || r.eventDate === eventDate,
  );
  const group = (rows, key) =>
    Object.entries(
      rows.reduce((m, r) => {
        const k = key(r);
        m[k] = (m[k] || 0) + 1;
        return m;
      }, Object.create(null)),
    )
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));
  const latest = new Map();
  let invalidResults = 0,
    repeatedAttempts = 0;
  for (const r of res.rows) {
    const d = day(r.resultAt, source.timeZone);
    if (!d) {
      invalidResults++;
      continue;
    }
    if (!inRange(d) || (category && r.category !== category)) continue;
    const prev = latest.get(r.participant);
    if (prev) repeatedAttempts++;
    if (!prev || Date.parse(r.resultAt) > Date.parse(prev.resultAt))
      latest.set(r.participant, r);
    else if (
      Date.parse(r.resultAt) === Date.parse(prev.resultAt) &&
      (prev.status !== r.status || prev.level !== r.level)
    )
      latest.set(r.participant, { ...prev, status: "ambiguous", level: "" });
  }
  const levels = { gold: 0, silver: 0, bronze: 0, unknown: 0 };
  let passed = 0,
    notPassed = 0,
    unknownStatus = 0,
    conflictingResults = 0;
  for (const r of latest.values()) {
    if (
      r.status === "not-passed" &&
      ["gold", "silver", "bronze"].includes(r.level)
    ) {
      conflictingResults++;
      unknownStatus++;
      levels.unknown++;
      continue;
    }
    if (r.status === "passed") passed++;
    else if (r.status === "not-passed") notPassed++;
    else unknownStatus++;
    if (r.status === "passed" && ["gold", "silver", "bronze"].includes(r.level))
      levels[r.level]++;
    else levels.unknown++;
  }
  return {
    timeZone: source.timeZone,
    levelMeaning: source.levelMeaning,
    filters,
    registrations: {
      total: registrations.length,
      uniqueParticipants: new Set(registrations.map((r) => r.participant)).size,
      period: period.length,
      event: selected.length,
      byDay: group(selected, (r) => day(r.registeredAt, source.timeZone)),
      byEvent: group(period, (r) => r.eventDate),
    },
    results: {
      uniqueParticipants: latest.size,
      passed,
      notPassed,
      unknownStatus,
      levels,
      repeatedAttempts,
      conflictingResults,
    },
    quality: {
      registrationDuplicates: reg.duplicates,
      resultDuplicates: res.duplicates,
      registrationConflicts: reg.conflicts,
      resultConflicts: res.conflicts,
      invalidRegistrations: reg.invalid + invalidDates,
      invalidResults: res.invalid + invalidResults,
    },
    categories: [
      ...new Set(
        [...source.registrations, ...source.results]
          .map((r) => r.category)
          .filter(Boolean),
      ),
    ].sort(),
    protocol: {
      checked: false,
      message:
        "Лист «Протокол» и A2 не читались и не изменялись. Соответствие протокола дате не проверено.",
    },
  };
}
