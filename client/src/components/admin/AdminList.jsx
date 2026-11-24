import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFetch } from '../../lib/useFetch.js';
import { ExportButton } from '../dashboard/Widgets.jsx';
import { Alert, EmptyState, Loading, Pagination } from '../ui/index.js';

const control =
  'min-h-9 min-w-0 rounded-field border border-line-strong bg-surface px-2.5 text-sm text-ink';

/**
 * A filtered, paginated admin list with CSV download (SPEC Module 10).
 * - `path`: the list endpoint; `filters`: `[{ name, label, options: [{value,label}] }]`.
 * - `search`: placeholder text to show a search box; `dates`: show from/to filters.
 * - `columns`: `[{ header, cell(row), className? }]`; on phones rows become cards.
 * - `expand(row, reload)`: optional detail shown under a row when opened.
 * - `extraQuery`: fixed query values, such as `{ status: 'PENDING' }`.
 */
export function AdminList({
  path,
  filters = [],
  search,
  dates = false,
  csv = true,
  filename,
  columns,
  expand,
  extraQuery = {},
  empty = 'Nothing matches',
}) {
  // Filters can start from the address, so other pages can link to a filtered list.
  const [params] = useSearchParams();
  const [values, setValues] = useState(() => Object.fromEntries(params));
  const [text, setText] = useState(() => params.get('q') ?? '');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);

  const query = new URLSearchParams({ ...extraQuery });
  for (const [key, value] of Object.entries(values)) if (value) query.set(key, value);
  const filterQuery = query.toString();
  query.set('page', String(page));
  const { data, error, loading, reload } = useFetch(`${path}?${query}`);

  const set = (name, value) => {
    setValues((v) => ({ ...v, [name]: value }));
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {search ? (
          <form
            className="flex min-w-0 flex-1 basis-56 gap-2"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              set('q', text.trim());
            }}
          >
            <input
              type="search"
              className={`${control} flex-1`}
              placeholder={search}
              aria-label={search}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button type="submit" className={`${control} font-medium hover:bg-paper`}>
              Search
            </button>
          </form>
        ) : null}
        {filters.map((filter) => (
          <label key={filter.name} className="flex flex-col gap-1 text-xs text-muted">
            {filter.label}
            <select
              className={control}
              value={values[filter.name] ?? ''}
              onChange={(e) => set(filter.name, e.target.value)}
            >
              <option value="">All</option>
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        {dates ? (
          <>
            <label className="flex flex-col gap-1 text-xs text-muted">
              From
              <input
                type="date"
                className={control}
                value={values.from ?? ''}
                onChange={(e) => set('from', e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              To
              <input
                type="date"
                className={control}
                value={values.to ?? ''}
                onChange={(e) => set('to', e.target.value)}
              />
            </label>
          </>
        ) : null}
        {csv ? (
          <div className="ml-auto">
            <ExportButton path={`${path}?${filterQuery}`} filename={filename} />
          </div>
        ) : null}
      </div>

      {data ? (
        <p className="text-sm text-muted" aria-live="polite">
          {data.total} {data.total === 1 ? 'result' : 'results'}
        </p>
      ) : null}
      {error ? <Alert tone="error">{error.message}</Alert> : null}
      {!data ? (
        error ? null : (
          <Loading />
        )
      ) : data.items.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <div className={`transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          <ul className="divide-y divide-line rounded-card border border-line bg-surface">
            <li
              aria-hidden="true"
              className="hidden gap-3 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted md:grid md:[grid-template-columns:var(--cols)]"
              style={{ '--cols': gridColumns(columns, expand) }}
            >
              {columns.map((column) => (
                <span key={column.header}>{column.header}</span>
              ))}
              {expand ? <span /> : null}
            </li>
            {data.items.map((row) => {
              const id = row.id ?? row.bookingId;
              const open = openId === id;
              return (
                <li key={id} className="px-4 py-3">
                  <div
                    className="grid gap-1 md:items-center md:gap-3 md:[grid-template-columns:var(--cols)]"
                    style={{ '--cols': gridColumns(columns, expand) }}
                  >
                    {columns.map((column) => (
                      <div
                        key={column.header}
                        className={`min-w-0 break-words text-sm ${column.className ?? ''}`}
                      >
                        <span className="mr-1.5 text-xs text-muted md:hidden">
                          {column.header}:
                        </span>
                        {column.cell(row)}
                      </div>
                    ))}
                    {expand ? (
                      <div className="md:text-right">
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => setOpenId(open ? null : id)}
                          className="text-sm font-medium text-accent hover:underline"
                        >
                          {open ? 'Close' : 'Open'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {open ? (
                    <div className="mt-3 border-t border-line pt-3">{expand(row, reload)}</div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            disabled={loading}
            onChange={setPage}
          />
        </div>
      )}
    </div>
  );
}

function gridColumns(columns, expand) {
  const widths = columns.map((c) => c.width ?? 'minmax(0,1fr)');
  if (expand) widths.push('4rem');
  return widths.join(' ');
}
