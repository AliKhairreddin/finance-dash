import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useSyncExternalStore
} from "react";

type UrlHistoryMode = "push" | "replace";

export type UrlStateOptions<T extends string> = {
  allowedValues?: readonly T[];
  clearOtherSearchParams?: boolean;
  history?: UrlHistoryMode;
  isValid?: (value: string) => boolean;
};

export type UrlDateRange = {
  fromDate: string;
  toDate: string;
};

const urlStateChangeEvent = "finance-dash:url-state-change";
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function asUrl(url: string | URL): URL {
  return url instanceof URL ? new URL(url.toString()) : new URL(url);
}

export function isIsoDate(value: string): boolean {
  if (!isoDatePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function readUrlState<T extends string>(
  url: string | URL,
  key: string,
  defaultValue: T,
  options: Pick<UrlStateOptions<T>, "allowedValues" | "isValid"> = {}
): T {
  const value = asUrl(url).searchParams.get(key);
  if (value === null) return defaultValue;
  if (options.allowedValues && !options.allowedValues.includes(value as T)) return defaultValue;
  if (options.isValid && !options.isValid(value)) return defaultValue;
  return value as T;
}

export function writeUrlState<T extends string>(
  url: string | URL,
  key: string,
  value: T,
  defaultValue: T,
  clearOtherSearchParams = false
): URL {
  const nextUrl = asUrl(url);
  if (clearOtherSearchParams) nextUrl.search = "";
  if (value === defaultValue) {
    nextUrl.searchParams.delete(key);
  } else {
    nextUrl.searchParams.set(key, value);
  }
  return nextUrl;
}

export function readUrlDateRange(
  url: string | URL,
  fromKey: string,
  toKey: string,
  defaultValue: UrlDateRange
): UrlDateRange {
  const params = asUrl(url).searchParams;
  const fromDate = params.get(fromKey);
  const toDate = params.get(toKey);
  if (!fromDate && !toDate) return defaultValue;
  if (!fromDate || !toDate || !isIsoDate(fromDate) || !isIsoDate(toDate) || fromDate > toDate) {
    return defaultValue;
  }
  return { fromDate, toDate };
}

export function writeUrlDateRange(
  url: string | URL,
  fromKey: string,
  toKey: string,
  value: UrlDateRange,
  defaultValue: UrlDateRange
): URL {
  const nextUrl = asUrl(url);
  if (value.fromDate === defaultValue.fromDate && value.toDate === defaultValue.toDate) {
    nextUrl.searchParams.delete(fromKey);
    nextUrl.searchParams.delete(toKey);
  } else {
    nextUrl.searchParams.set(fromKey, value.fromDate);
    nextUrl.searchParams.set(toKey, value.toDate);
  }
  return nextUrl;
}

function subscribeToUrl(callback: () => void): () => void {
  window.addEventListener("popstate", callback);
  window.addEventListener(urlStateChangeEvent, callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener(urlStateChangeEvent, callback);
  };
}

function currentUrlSnapshot(): string {
  return window.location.href;
}

function serverUrlSnapshot(): string {
  return "http://localhost/";
}

function commitUrl(url: URL, history: UrlHistoryMode): void {
  const nextLocation = `${url.pathname}${url.search}${url.hash}`;
  window.history[history === "push" ? "pushState" : "replaceState"]({}, "", nextLocation);
  window.dispatchEvent(new Event(urlStateChangeEvent));
}

export function useUrlState<T extends string = string>(
  key: string,
  defaultValue: NoInfer<T>,
  options: UrlStateOptions<T> = {}
): [T, Dispatch<SetStateAction<T>>] {
  const snapshot = useSyncExternalStore(subscribeToUrl, currentUrlSnapshot, serverUrlSnapshot);
  const allowedValuesKey = options.allowedValues?.join("\u0000") ?? "";
  const value = readUrlState(snapshot, key, defaultValue, options);

  const setValue = useCallback<Dispatch<SetStateAction<T>>>((nextValue) => {
    const currentValue = readUrlState(window.location.href, key, defaultValue, options);
    const resolvedValue = typeof nextValue === "function"
      ? (nextValue as (current: T) => T)(currentValue)
      : nextValue;
    if (resolvedValue === currentValue) return;

    const nextUrl = writeUrlState(
      window.location.href,
      key,
      resolvedValue,
      defaultValue,
      options.clearOtherSearchParams
    );
    commitUrl(nextUrl, options.history ?? "replace");
  }, [
    allowedValuesKey,
    defaultValue,
    key,
    options.clearOtherSearchParams,
    options.history,
    options.isValid
  ]);

  return [value, setValue];
}

export function useUrlDateRangeState(
  fromKey: string,
  toKey: string,
  defaultValue: UrlDateRange
): [UrlDateRange, Dispatch<SetStateAction<UrlDateRange>>] {
  const snapshot = useSyncExternalStore(subscribeToUrl, currentUrlSnapshot, serverUrlSnapshot);
  const value = readUrlDateRange(snapshot, fromKey, toKey, defaultValue);

  const setValue = useCallback<Dispatch<SetStateAction<UrlDateRange>>>((nextValue) => {
    const currentValue = readUrlDateRange(window.location.href, fromKey, toKey, defaultValue);
    const resolvedValue = typeof nextValue === "function"
      ? (nextValue as (current: UrlDateRange) => UrlDateRange)(currentValue)
      : nextValue;
    if (
      resolvedValue.fromDate === currentValue.fromDate &&
      resolvedValue.toDate === currentValue.toDate
    ) {
      return;
    }
    if (
      !isIsoDate(resolvedValue.fromDate) ||
      !isIsoDate(resolvedValue.toDate) ||
      resolvedValue.fromDate > resolvedValue.toDate
    ) {
      return;
    }

    const nextUrl = writeUrlDateRange(
      window.location.href,
      fromKey,
      toKey,
      resolvedValue,
      defaultValue
    );
    commitUrl(nextUrl, "replace");
  }, [defaultValue.fromDate, defaultValue.toDate, fromKey, toKey]);

  return [value, setValue];
}
