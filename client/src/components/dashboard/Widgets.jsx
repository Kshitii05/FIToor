import { useState } from 'react';
import { downloadFile } from '../../lib/api.js';
import { presetRange, RANGE_PRESETS, todayInIndia } from '../../lib/dashboard.js';
import { Button, FilterTabs } from '../ui/index.js';

/** One headline number with a label and an optional line under it. */
export function StatTile({ label, value, note }) {
  return (
    <div className="min-w-0 rounded-card border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 truncate font-display text-2xl font-semibold text-ink">{value}</p>
      {note ? <p className="mt-1 text-xs text-muted">{note}</p> : null}
    </div>
  );
}

export function StatGrid({ children }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

const dateInput =
  'min-h-9 rounded-field border border-line-strong bg-surface px-2 text-sm text-ink';

/**
 * Preset ranges (last 7, 30, 90 days, 12 months) and a custom from/to. `value` is
 * `{ preset, from, to }`; `onChange` gets the next value.
 */
export function DateRangeFilter({ value, onChange }) {
  const today = todayInIndia();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <FilterTabs
        label="Period"
        options={[...RANGE_PRESETS, { value: 'custom', label: 'Custom' }]}
        value={value.preset}
        onChange={(preset) =>
          onChange(preset === 'custom' ? { ...value, preset } : { preset, ...presetRange(preset) })
        }
      />
      {value.preset === 'custom' ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <label className="flex items-center gap-1.5">
            From
            <input
              type="date"
              className={dateInput}
              value={value.from}
              max={value.to}
              onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-1.5">
            To
            <input
              type="date"
              className={dateInput}
              value={value.to}
              min={value.from}
              max={today}
              onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

/** A "Download CSV" button for an endpoint that answers `?format=csv`. */
export function ExportButton({ path, filename, label = 'Download CSV' }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function download() {
    setBusy(true);
    setError(null);
    try {
      const join = path.includes('?') ? '&' : '?';
      await downloadFile(`${path}${join}format=csv`, filename);
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" size="sm" loading={busy} onClick={download}>
        {label}
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
