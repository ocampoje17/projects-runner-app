export type DateFormatPreference = "dd/mm/yyyy" | "mm/dd/yyyy";

const DEFAULT_DATE_FORMAT: DateFormatPreference = "dd/mm/yyyy";

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function resolveDate(value: string | number | Date) {
  return value instanceof Date ? value : new Date(value);
}

export function isDateFormatPreference(value: string | null): value is DateFormatPreference {
  return value === "dd/mm/yyyy" || value === "mm/dd/yyyy";
}

export function getCurrentDateFormatPreference(): DateFormatPreference {
  if (typeof document !== "undefined") {
    const datasetValue = document.documentElement.dataset.dateFormat ?? null;
    if (isDateFormatPreference(datasetValue)) {
      return datasetValue;
    }
  }

  if (typeof localStorage !== "undefined") {
    const savedValue = localStorage.getItem("dateFormat");
    if (isDateFormatPreference(savedValue)) {
      return savedValue;
    }
  }

  return DEFAULT_DATE_FORMAT;
}

export function formatDate(value: string | number | Date, dateFormat: DateFormatPreference = getCurrentDateFormatPreference()) {
  const date = resolveDate(value);
  const day = pad2(date.getDate());
  const month = pad2(date.getMonth() + 1);
  const year = date.getFullYear();

  return dateFormat === "mm/dd/yyyy" ? `${month}/${day}/${year}` : `${day}/${month}/${year}`;
}

export function formatTime(value: string | number | Date) {
  const date = resolveDate(value);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function formatDateTime(value: string | number | Date, dateFormat: DateFormatPreference = getCurrentDateFormatPreference()) {
  return `${formatDate(value, dateFormat)} ${formatTime(value)}`;
}
