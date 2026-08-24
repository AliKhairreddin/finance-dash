import { CalendarRange, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  bankPeriodPresetLabel,
  bankPeriodPresetRange,
  bankPeriodPresets,
  type BankPeriodPreset
} from "../../../shared/bankPeriods";
import { Button } from "./button";
import { NativeSelect, NativeSelectOption } from "./native-select";
import { financeOperatingDate } from "../../../shared/operatingDate";

export type CalendarDateRange = {
  fromDate: string;
  toDate: string;
};

export type CalendarPeriodPickerOption = {
  value: string;
  label: string;
};

function calendarDateLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}

function calendarMonth(value: string): string {
  return value.slice(0, 7);
}

function shiftCalendarMonth(value: string, months: number): string {
  const date = new Date(`${value}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 7);
}

function calendarMonthLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${value}-01T00:00:00.000Z`));
}

export function calendarDateRangeLabel(dateRange: CalendarDateRange): string {
  if (dateRange.fromDate === dateRange.toDate) return calendarDateLabel(dateRange.fromDate);
  if (dateRange.fromDate.slice(0, 4) !== dateRange.toDate.slice(0, 4)) {
    return `${calendarDateLabel(dateRange.fromDate)} – ${calendarDateLabel(dateRange.toDate)}`;
  }
  const fromDate = new Date(`${dateRange.fromDate}T00:00:00`);
  const toDate = new Date(`${dateRange.toDate}T00:00:00`);
  if (dateRange.fromDate.slice(0, 7) === dateRange.toDate.slice(0, 7)) {
    const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(fromDate);
    return `${month} ${fromDate.getDate()}–${toDate.getDate()}, ${dateRange.toDate.slice(0, 4)}`;
  }
  const compactFrom = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(fromDate);
  return `${compactFrom}–${calendarDateLabel(dateRange.toDate)}`;
}

function calendarDays(value: string): Array<string | null> {
  const [year, month] = value.split("-").map(Number);
  const firstDate = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mondayOffset = (firstDate.getUTCDay() + 6) % 7;
  return [
    ...Array.from<null>({ length: mondayOffset }).fill(null),
    ...Array.from({ length: daysInMonth }, (_, index) =>
      `${value}-${String(index + 1).padStart(2, "0")}`
    )
  ];
}

export function CalendarPeriodPicker({
  ariaLabel,
  dateRange,
  disabled = false,
  isLoading = false,
  onApply,
  onSelectPreset,
  presetAriaLabel,
  presetOptions,
  triggerClassName,
  triggerLabel
}: {
  ariaLabel: string;
  dateRange: CalendarDateRange;
  disabled?: boolean;
  isLoading?: boolean;
  onApply: (dateRange: CalendarDateRange) => void | Promise<void>;
  onSelectPreset: (value: string) => void | Promise<void>;
  presetAriaLabel: string;
  presetOptions: CalendarPeriodPickerOption[];
  triggerClassName?: string;
  triggerLabel: string;
}) {
  const today = financeOperatingDate();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [draftFromDate, setDraftFromDate] = useState(dateRange.fromDate);
  const [draftToDate, setDraftToDate] = useState(dateRange.toDate);
  const [visibleMonth, setVisibleMonth] = useState(calendarMonth(dateRange.toDate));
  const [selectingEnd, setSelectingEnd] = useState(false);
  const [preset, setPreset] = useState("");
  const [panelPosition, setPanelPosition] = useState({ top: 0, left: 0 });
  const visibleDays = useMemo(() => calendarDays(visibleMonth), [visibleMonth]);

  function positionPanel(): void {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const panelWidth = Math.min(340, window.innerWidth - 24);
    const estimatedHeight = 440;
    const left = Math.min(
      Math.max(12, rect.left),
      Math.max(12, window.innerWidth - panelWidth - 12)
    );
    const top = rect.bottom + 8 + estimatedHeight <= window.innerHeight
      ? rect.bottom + 8
      : Math.max(12, rect.top - estimatedHeight - 8);
    setPanelPosition({ top, left });
  }

  function openPicker(): void {
    setDraftFromDate(dateRange.fromDate);
    setDraftToDate(dateRange.toDate);
    setVisibleMonth(calendarMonth(dateRange.toDate));
    setSelectingEnd(false);
    setIsOpen(true);
  }

  function selectDate(value: string): void {
    if (value > today) return;
    if (!selectingEnd) {
      setDraftFromDate(value);
      setDraftToDate(value);
      setSelectingEnd(true);
      return;
    }
    setDraftFromDate(value < draftFromDate ? value : draftFromDate);
    setDraftToDate(value < draftFromDate ? draftFromDate : value);
    setSelectingEnd(false);
  }

  useEffect(() => {
    if (!isOpen) return;
    positionPanel();

    function closeOnOutsidePointer(event: PointerEvent): void {
      const target = event.target as Node;
      if (
        panelRef.current?.contains(target)
        || triggerRef.current?.contains(target)
        || (target instanceof Element && target.closest(".searchable-select-positioner"))
      ) return;
      setIsOpen(false);
    }

    function closeOnEscape(event: globalThis.KeyboardEvent): void {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      triggerRef.current?.focus();
    }

    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", positionPanel, true);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const visibleMonthIsCurrentOrFuture = visibleMonth >= calendarMonth(today);
  return (
    <>
      <Button
        ref={triggerRef}
        className={`secondary-button bank-date-range-trigger ${triggerClassName ?? ""}`.trim()}
        type="button"
        aria-label={`${ariaLabel}: ${triggerLabel}`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => (isOpen ? setIsOpen(false) : openPicker())}
      >
        {isLoading ? <Loader2 className="spin" size={16} /> : <CalendarRange size={16} />}
        <span>{triggerLabel}</span>
      </Button>
      {isOpen && createPortal(
        <div
          ref={panelRef}
          className="bank-date-range-popover"
          role="dialog"
          aria-label={ariaLabel}
          style={{ top: panelPosition.top, left: panelPosition.left }}
        >
          <div className="bank-calendar-shortcuts">
            <span>Quick period</span>
            <NativeSelect
              className="bank-calendar-preset-select"
              aria-label={presetAriaLabel}
              size="sm"
              value={preset}
              disabled={disabled || isLoading}
              onValueChange={(value) => {
                if (!value) return;
                setPreset(value);
                setIsOpen(false);
                void Promise.resolve(onSelectPreset(value)).finally(() => setPreset(""));
              }}
            >
              <NativeSelectOption value="" disabled>Presets</NativeSelectOption>
              {presetOptions.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="bank-calendar-header">
            <Button
              className="icon-button"
              type="button"
              aria-label="Previous month"
              onClick={() => setVisibleMonth((current) => shiftCalendarMonth(current, -1))}
            >
              <ChevronLeft size={16} />
            </Button>
            <strong>{calendarMonthLabel(visibleMonth)}</strong>
            <Button
              className="icon-button"
              type="button"
              aria-label="Next month"
              disabled={visibleMonthIsCurrentOrFuture}
              onClick={() => setVisibleMonth((current) => shiftCalendarMonth(current, 1))}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
          <div className="bank-calendar-weekdays" aria-hidden="true">
            {["M", "T", "W", "T", "F", "S", "S"].map((weekday, index) => (
              <span key={`${weekday}-${index}`}>{weekday}</span>
            ))}
          </div>
          <div className="bank-calendar-grid" role="grid">
            {visibleDays.map((value, index) => {
              if (!value) return <span className="bank-calendar-empty" key={`empty-${index}`} />;
              const isSelected = value === draftFromDate || value === draftToDate;
              const isInRange = value > draftFromDate && value < draftToDate;
              const isFuture = value > today;
              return (
                <button
                  key={value}
                  className={`${isSelected ? "selected" : ""} ${isInRange ? "in-range" : ""}`.trim()}
                  type="button"
                  role="gridcell"
                  aria-label={calendarDateLabel(value)}
                  aria-selected={isSelected || isInRange}
                  disabled={isFuture}
                  onClick={() => selectDate(value)}
                >
                  {Number(value.slice(-2))}
                </button>
              );
            })}
          </div>
          <div className="bank-calendar-selection">
            <span>{calendarDateRangeLabel({ fromDate: draftFromDate, toDate: draftToDate })}</span>
            <span>{selectingEnd ? "Choose an end date or apply one day" : "Range ready"}</span>
          </div>
          <div className="bank-calendar-actions">
            <Button className="secondary-button" type="button" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button
              className="primary-button"
              type="button"
              disabled={disabled || isLoading || !draftFromDate || !draftToDate || draftToDate > today}
              onClick={() => {
                setIsOpen(false);
                void onApply({ fromDate: draftFromDate, toDate: draftToDate });
              }}
            >
              Apply
            </Button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export function BankPeriodPicker({
  dateRange,
  isLoading,
  onLoad,
  windowDays
}: {
  dateRange: CalendarDateRange;
  isLoading: boolean;
  onLoad: (dateRange: CalendarDateRange) => void | Promise<void>;
  windowDays: number;
}) {
  return (
    <CalendarPeriodPicker
      ariaLabel="Choose transaction period"
      dateRange={dateRange}
      disabled={isLoading}
      isLoading={isLoading}
      onApply={onLoad}
      onSelectPreset={(value) => onLoad(bankPeriodPresetRange(
        value as BankPeriodPreset,
        financeOperatingDate(),
        windowDays
      ))}
      presetAriaLabel="Transaction period presets"
      presetOptions={bankPeriodPresets.map((option) => ({
        value: option,
        label: bankPeriodPresetLabel(option, windowDays)
      }))}
      triggerLabel={calendarDateRangeLabel(dateRange)}
    />
  );
}
