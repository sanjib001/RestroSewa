import { HISTORY_PERIODS, HISTORY_PERIOD_LABEL, type HistoryPeriod } from "@/lib/history-period";

// The pill-row period filter, factored out of the Finance report picker so every
// simple chronological list (Security activity, Report delivery history,
// Purchases, Savings, …) gets the same look and the same period names, rather
// than each screen growing its own slightly different row of buttons.
//
// The optional calendar input is a SEPARATE choice, not a sixth period: picking
// a day scopes everything to that one business day and none of the pills read
// as active while it's set, since the pills and the day both answer "which
// window" and only one answer applies at a time. Clearing the date (the native
// "×" a date input grows once it holds a value) falls back to whichever pill was
// last selected.
export function PeriodFilter({
  value,
  onChange,
  date,
  onDateChange,
  periods = HISTORY_PERIODS,
}: {
  value: HistoryPeriod;
  onChange: (p: HistoryPeriod) => void;
  /** YYYY-MM-DD, or "" for no specific day chosen. Omit the prop to skip the picker entirely. */
  date?: string;
  onDateChange?: (d: string) => void;
  periods?: HistoryPeriod[];
}) {
  const dayChosen = !!date;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {periods.map((p) => {
          const active = !dayChosen && value === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() => {
                onDateChange?.("");
                onChange(p);
              }}
              className="shrink-0 text-sm px-3 py-1.5 rounded-full border transition-colors"
              style={{
                borderColor: active ? "var(--color-primary)" : "var(--color-hairline)",
                background: active ? "var(--color-primary)" : "var(--color-canvas)",
                color: active ? "#fff" : "var(--color-ink)",
              }}
            >
              {HISTORY_PERIOD_LABEL[p]}
            </button>
          );
        })}
      </div>
      {onDateChange && (
        <input
          type="date"
          value={date ?? ""}
          onChange={(e) => onDateChange(e.target.value)}
          aria-label="Choose a specific day"
          className="shrink-0 text-sm rounded-full border px-3 py-1.5"
          style={{
            borderColor: dayChosen ? "var(--color-primary)" : "var(--color-hairline)",
            background: "var(--color-canvas)",
            color: "var(--color-ink)",
          }}
        />
      )}
    </div>
  );
}
