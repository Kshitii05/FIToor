import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { axisRupees, bucketLabel, compactRupees } from '../../lib/dashboard.js';
import { formatPaise } from '../../lib/money.js';

// Chart colours come from the theme, so charts match the rest of the site.
const COLORS = ['var(--color-accent)', 'var(--color-notice)', 'var(--color-danger)'];

const axis = { stroke: 'var(--color-muted)', fontSize: 12, tickLine: false };

/**
 * A time series as lines or bars. `series` is a list of `{ key, label, money? }`;
 * money values are paise and shown in rupees. Charts are described in text too
 * (`summary`), for screen readers.
 */
export function TrendChart({ data, bucket, series, kind = 'line', height = 240, summary }) {
  const money = series.some((s) => s.money);
  const rows = data.map((row) => {
    const out = { label: bucketLabel(row.bucket, bucket) };
    for (const s of series) out[s.key] = s.money ? axisRupees(row[s.key] ?? 0) : (row[s.key] ?? 0);
    return out;
  });
  const Chart = kind === 'bar' ? BarChart : LineChart;
  const tooltip = (value, name) => {
    const entry = series.find((s) => s.label === name);
    return [entry?.money ? formatPaise(value * 100) : value, name];
  };

  return (
    <figure>
      <div style={{ height }} role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height="100%">
          <Chart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--color-line)" vertical={false} />
            <XAxis dataKey="label" {...axis} minTickGap={16} />
            <YAxis
              {...axis}
              width={money ? 56 : 32}
              allowDecimals={false}
              tickFormatter={money ? compactRupees : undefined}
            />
            <Tooltip
              formatter={tooltip}
              contentStyle={{
                borderRadius: 8,
                borderColor: 'var(--color-line)',
                fontSize: 13,
              }}
            />
            {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 13 }} /> : null}
            {series.map((s, index) =>
              kind === 'bar' ? (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  fill={COLORS[index % COLORS.length]}
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={false}
                />
              ) : (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={COLORS[index % COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              ),
            )}
          </Chart>
        </ResponsiveContainer>
      </div>
      {summary ? <figcaption className="sr-only">{summary}</figcaption> : null}
    </figure>
  );
}

/** Horizontal bars for a ranking (categories, areas). Values are counts. */
export function RankChart({ data, labelKey, valueKey, valueLabel, height }) {
  const rows = data.map((row) => ({ label: row[labelKey], value: row[valueKey] }));
  return (
    <div
      style={{ height: height ?? Math.max(120, rows.length * 32 + 24) }}
      role="img"
      aria-label={rows.map((r) => `${r.label}: ${r.value}`).join(', ')}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
          <XAxis type="number" {...axis} allowDecimals={false} />
          <YAxis type="category" dataKey="label" {...axis} width={110} />
          <Tooltip formatter={(value) => [value, valueLabel]} />
          <Bar
            dataKey="value"
            name={valueLabel}
            fill="var(--color-accent)"
            radius={[0, 3, 3, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
