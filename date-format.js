(function () {
  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function formatDisplayDateFromParts(day, month, year) {
    return `${pad2(day)}/${pad2(month)}/${year}`;
  }

  function formatDisplayDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    return formatDisplayDateFromParts(date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCFullYear());
  }

  function formatDisplayDateTime(date) {
    const base = formatDisplayDate(date);
    if (!base) return null;
    return `${base} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
  }

  function splitSlashDateParts(first, second, preferDayFirst = false) {
    const a = Number(first);
    const b = Number(second);

    if (a > 12 && b >= 1 && b <= 12) {
      return { day: a, month: b };
    }
    if (b > 12 && a >= 1 && a <= 12) {
      return { day: b, month: a };
    }
    if (preferDayFirst) {
      return { day: a, month: b };
    }

    return { day: b, month: a };
  }

  function parseSlashDateText(text, preferDayFirst = false) {
    const match = String(text || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return null;

    const [, first, second, year] = match;
    const { day, month } = splitSlashDateParts(first, second, preferDayFirst);
    const parsed = new Date(`${year}-${pad2(month)}-${pad2(day)}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function parseFlexibleDate(value) {
    const text = String(value ?? "").trim();
    if (!text) return null;

    const isoDateTime = text.match(/^(\d{4})-(\d{2})-(\d{2})T/);
    if (isoDateTime) {
      const parsed = new Date(text);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }

    const isoDateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDateOnly) {
      return new Date(`${isoDateOnly[1]}-${isoDateOnly[2]}-${isoDateOnly[3]}T00:00:00Z`);
    }

    const slashWithTime = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})T/i);
    if (slashWithTime) {
      return parseSlashDateText(text.slice(0, slashWithTime[0].length - 1), true);
    }

    const slashDate = parseSlashDateText(text);
    if (slashDate) return slashDate;

    const dmyMatch = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (dmyMatch) {
      const parsed = new Date(`${dmyMatch[3]} ${dmyMatch[2]} ${dmyMatch[1]} 00:00:00 UTC`);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }

    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function parseSlashDateTime(value) {
    const text = String(value ?? "").trim();
    if (!text) return null;

    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
    if (isoMatch) {
      const [, year, month, day, hour, minute] = isoMatch.map(Number);
      return new Date(Date.UTC(year, month - 1, day, hour, minute));
    }

    const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})/);
    if (slashMatch) {
      const [, first, second, year, hour, minute] = slashMatch;
      const { day, month } = splitSlashDateParts(first, second);
      return new Date(Date.UTC(Number(year), month - 1, day, Number(hour), Number(minute)));
    }

    const dateOnly = parseFlexibleDate(text);
    if (dateOnly) return dateOnly;

    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function formatSlashDateValue(text) {
    const match = String(text || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!match) return null;

    const [, first, second, year] = match;
    const { day, month } = splitSlashDateParts(first, second);
    return formatDisplayDateFromParts(day, month, Number(year));
  }

  function formatDisplayDateValue(value) {
    const text = String(value ?? "").trim();
    if (!text) return "";

    const parsed = parseFlexibleDate(text);
    if (parsed) {
      const formatted = formatDisplayDate(parsed);
      if (!formatted) return text;

      const slashMatch = text.match(/^(\d{1,2}\/\d{1,2}\/\d{4})([\s\S]*)$/);
      if (slashMatch) {
        const suffix = slashMatch[2] || "";
        if (suffix && !/^T/i.test(suffix)) {
          return formatted + suffix;
        }
      }

      return formatted;
    }

    return text;
  }

  function formatUploadTimestampLocal(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  window.DashboardDateFormat = {
    formatDisplayDate,
    formatDisplayDateTime,
    formatDisplayDateValue,
    parseFlexibleDate,
    parseSlashDateTime,
    formatUploadTimestampLocal
  };
}());
