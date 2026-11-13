import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ListingGrid } from '../components/listings/ListingCard.jsx';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  EmptyState,
  FilterTabs,
  Loading,
  Pagination,
  SelectField,
  TextField,
} from '../components/ui/index.js';
import { api } from '../lib/api.js';
import { CATEGORIES, CONDITIONS } from '../lib/listings.js';
import { formatPaise, paiseToRupeeInput, rupeesToPaise } from '../lib/money.js';

// Everything about a search lives in the address bar, so it can be bookmarked,
// shared and navigated with the back button. Prices there are in rupees.

const SORTS = [
  { value: 'relevance', label: 'Best match' },
  { value: 'newest', label: 'Newest first' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'popular', label: 'Most popular' },
];

const MODES = [
  { value: '', label: 'All' },
  { value: 'SALE', label: 'For sale' },
  { value: 'RENT', label: 'For rent' },
];

const listParam = (params, name) => (params.get(name) ?? '').split(',').filter(Boolean);

/** The API request for the search described by the address bar. */
function apiQueryFrom(params) {
  const query = new URLSearchParams();
  for (const name of [
    'q',
    'mode',
    'category',
    'condition',
    'brand',
    'size',
    'colour',
    'sort',
    'page',
  ]) {
    const value = params.get(name);
    if (value) query.set(name, value);
  }
  for (const [name, apiName] of [
    ['minPrice', 'minPricePaise'],
    ['maxPrice', 'maxPricePaise'],
  ]) {
    const paise = params.get(name) ? rupeesToPaise(params.get(name)) : null;
    if (paise !== null) query.set(apiName, String(paise));
  }
  if (params.get('available') === 'true') query.set('available', 'true');
  query.set('pageSize', '24');
  return query.toString();
}

function CheckboxGroup({ legend, options, selected, onChange }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-ink">{legend}</legend>
      <div className="space-y-2">
        {options.map((option) => (
          <Checkbox
            key={option.value}
            label={option.label}
            checked={selected.includes(option.value)}
            onChange={(checked) =>
              onChange(
                checked
                  ? [...selected, option.value]
                  : selected.filter((value) => value !== option.value),
              )
            }
          />
        ))}
      </div>
    </fieldset>
  );
}

/** A drop-down of the values found in the results, keeping the chosen one listed. */
function FacetSelect({ label, anyLabel, values, value, onChange }) {
  const options = values.map((facet) => ({
    value: facet.value,
    label: `${facet.value} (${facet.count})`,
  }));
  if (value && !options.some((option) => option.value.toLowerCase() === value.toLowerCase())) {
    options.unshift({ value, label: value });
  }
  const chosen = options.find((option) => option.value.toLowerCase() === value.toLowerCase());
  return (
    <SelectField
      label={label}
      placeholder={anyLabel}
      options={options}
      value={chosen?.value ?? ''}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function PriceFilter({ minPrice, maxPrice, onApply }) {
  const [min, setMin] = useState(minPrice);
  const [max, setMax] = useState(maxPrice);
  const [error, setError] = useState(null);

  function handleSubmit(event) {
    event.preventDefault();
    const minPaise = min.trim() ? rupeesToPaise(min) : null;
    const maxPaise = max.trim() ? rupeesToPaise(max) : null;
    if ((min.trim() && minPaise === null) || (max.trim() && maxPaise === null)) {
      setError('Enter prices in rupees, like 500 or 1200');
      return;
    }
    if (minPaise !== null && maxPaise !== null && minPaise > maxPaise) {
      setError('The lowest price cannot be above the highest price');
      return;
    }
    setError(null);
    // Stored plainly in the address: "3,000" becomes "3000".
    onApply({
      minPrice: minPaise === null ? '' : paiseToRupeeInput(minPaise),
      maxPrice: maxPaise === null ? '' : paiseToRupeeInput(maxPaise),
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">Price</legend>
        <div className="grid grid-cols-2 gap-2">
          <TextField
            label={<span className="sr-only">Lowest price</span>}
            prefix="₹"
            inputMode="decimal"
            placeholder="Min"
            value={min}
            onChange={(event) => setMin(event.target.value)}
          />
          <TextField
            label={<span className="sr-only">Highest price</span>}
            prefix="₹"
            inputMode="decimal"
            placeholder="Max"
            value={max}
            onChange={(event) => setMax(event.target.value)}
          />
        </div>
        {error ? (
          <p role="alert" className="mt-1.5 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="secondary" size="sm" className="mt-2">
          Apply price
        </Button>
        <p className="mt-1.5 text-xs text-muted">For rentals, the cheapest package counts.</p>
      </fieldset>
    </form>
  );
}

function Filters({ params, facets, update }) {
  const minPrice = params.get('minPrice') ?? '';
  const maxPrice = params.get('maxPrice') ?? '';
  return (
    <div className="space-y-6">
      <CheckboxGroup
        legend="Category"
        options={CATEGORIES}
        selected={listParam(params, 'category')}
        onChange={(values) => update({ category: values.join(',') })}
      />
      <CheckboxGroup
        legend="Condition"
        options={CONDITIONS}
        selected={listParam(params, 'condition')}
        onChange={(values) => update({ condition: values.join(',') })}
      />
      {/* Remounted when the prices in the address change, so the boxes match them. */}
      <PriceFilter
        key={`${minPrice}-${maxPrice}`}
        minPrice={minPrice}
        maxPrice={maxPrice}
        onApply={update}
      />
      <FacetSelect
        label="Brand"
        anyLabel="Any brand"
        values={facets?.brands ?? []}
        value={params.get('brand') ?? ''}
        onChange={(brand) => update({ brand })}
      />
      <FacetSelect
        label="Size"
        anyLabel="Any size"
        values={facets?.sizes ?? []}
        value={params.get('size') ?? ''}
        onChange={(size) => update({ size })}
      />
      <FacetSelect
        label="Colour"
        anyLabel="Any colour"
        values={facets?.colours ?? []}
        value={params.get('colour') ?? ''}
        onChange={(colour) => update({ colour })}
      />
      <Checkbox
        label="Available now"
        description="Hide sold-out items."
        checked={params.get('available') === 'true'}
        onChange={(checked) => update({ available: checked ? 'true' : '' })}
      />
    </div>
  );
}

const FILTER_NAMES = [
  'mode',
  'category',
  'condition',
  'brand',
  'size',
  'colour',
  'minPrice',
  'maxPrice',
  'available',
];

function describe(params) {
  const q = params.get('q');
  const parts = [];
  if (params.get('minPrice') || params.get('maxPrice')) {
    const min = rupeesToPaise(params.get('minPrice') ?? '');
    const max = rupeesToPaise(params.get('maxPrice') ?? '');
    if (min !== null && max !== null) parts.push(`${formatPaise(min)}–${formatPaise(max)}`);
    else if (max !== null) parts.push(`up to ${formatPaise(max)}`);
    else if (min !== null) parts.push(`from ${formatPaise(min)}`);
  }
  if (params.get('brand')) parts.push(params.get('brand'));
  return { q, parts };
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [showFilters, setShowFilters] = useState(false);
  const apiQuery = apiQueryFrom(params);
  // Keyed by the request it answers, so an older reply never shows for a newer search.
  const [result, setResult] = useState({ key: null });

  useEffect(() => {
    let cancelled = false;
    api(`/listings?${apiQuery}`)
      .then((data) => {
        if (!cancelled) setResult({ key: apiQuery, data });
      })
      .catch((error) => {
        if (!cancelled) setResult({ key: apiQuery, error });
      });
    return () => {
      cancelled = true;
    };
  }, [apiQuery]);

  const loading = result.key !== apiQuery;
  const { data, error } = result;

  /** Changes some search settings. Any change except paging goes back to page 1. */
  function update(changes) {
    const next = new URLSearchParams(params);
    for (const [name, value] of Object.entries(changes)) {
      if (value) next.set(name, value);
      else next.delete(name);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  }

  function changePage(page) {
    update({ page: page > 1 ? String(page) : '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const activeFilters = FILTER_NAMES.filter((name) => params.get(name)).length;
  const hasKeyword = Boolean(params.get('q'));
  const sortOptions = hasKeyword ? SORTS : SORTS.filter((sort) => sort.value !== 'relevance');
  const currentSort = params.get('sort') ?? data?.sort ?? (hasKeyword ? 'relevance' : 'newest');
  const { q, parts } = describe(params);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="break-words font-display text-3xl font-semibold tracking-tight text-ink">
            {q ? `“${q}”` : 'Browse'}
          </h1>
          <p className="mt-1 text-sm text-muted" aria-live="polite">
            {data && !loading
              ? `${data.total} ${data.total === 1 ? 'result' : 'results'}${parts.length ? ` · ${parts.join(' · ')}` : ''}`
              : 'Searching…'}
          </p>
        </div>
        <div className="w-full sm:w-56">
          <SelectField
            label="Sort by"
            options={sortOptions}
            value={currentSort}
            onChange={(event) => update({ sort: event.target.value })}
          />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <FilterTabs
          label="Sale or rent"
          options={MODES}
          value={params.get('mode') ?? ''}
          onChange={(mode) => update({ mode })}
        />
        <Button
          variant="secondary"
          size="sm"
          className="lg:hidden"
          aria-expanded={showFilters}
          aria-controls="search-filters"
          onClick={() => setShowFilters((value) => !value)}
        >
          {showFilters ? 'Hide filters' : 'Filters'}
          {activeFilters ? ` (${activeFilters})` : ''}
        </Button>
        {activeFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => update(Object.fromEntries(FILTER_NAMES.map((name) => [name, ''])))}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[15rem_1fr]">
        <aside
          id="search-filters"
          aria-label="Filters"
          className={`${showFilters ? 'block' : 'hidden'} lg:block`}
        >
          <Card className="lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
            <Filters params={params} facets={data?.facets} update={update} />
          </Card>
        </aside>

        <section aria-label="Results" aria-busy={loading}>
          {error && !loading ? (
            <Alert tone="error">{error.message}</Alert>
          ) : !data ? (
            <Loading label="Searching" />
          ) : data.items.length === 0 ? (
            <EmptyState title="Nothing found">
              {activeFilters
                ? 'Try removing a filter or searching for something broader.'
                : 'Try a different word, or browse everything.'}
            </EmptyState>
          ) : (
            <div className={`transition-opacity ${loading ? 'opacity-60' : ''}`}>
              <ListingGrid listings={data.items} />
              <Pagination
                page={data.page}
                totalPages={data.totalPages}
                disabled={loading}
                onChange={changePage}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
