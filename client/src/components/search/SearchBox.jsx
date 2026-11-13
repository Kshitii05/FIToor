import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api.js';

const SUGGEST_DELAY_MS = 200;

const KIND_LABEL = { recent: 'Recent search', title: 'Listing', brand: 'Brand' };

/** Turns the suggestions response into one list of options, without repeats. */
function toOptions(data) {
  if (!data) return [];
  const seen = new Set();
  const options = [];
  const add = (kind, value) => {
    const key = `${kind === 'brand' ? 'brand' : 'text'}:${value.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    options.push({ kind, value });
  };
  data.recent.forEach((value) => add('recent', value));
  data.titles.forEach((value) => add('title', value));
  data.brands.forEach((value) => add('brand', value));
  return options;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The search box in the header. Suggests listing titles, brands and the user's
 * recent searches as they type; arrow keys move through them and Enter picks one.
 * `initialText` fills the box (the current search, when on the search page);
 * remount the component to change it.
 */
export function SearchBox({ initialText = '', className = '' }) {
  const navigate = useNavigate();
  const listId = useId();
  const [text, setText] = useState(initialText);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Keyed by the text it answers, so a slow reply never shows for newer text.
  const [result, setResult] = useState({ text: null, data: null });

  const typed = text.trim();

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      api(`/search/suggestions?q=${encodeURIComponent(typed)}`)
        .then((data) => {
          if (!cancelled) setResult({ text: typed, data });
        })
        .catch(() => {});
    }, SUGGEST_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [typed, open]);

  const options = open && result.text === typed ? toOptions(result.data) : [];
  const expanded = options.length > 0;

  function go(option) {
    setOpen(false);
    setActive(-1);
    if (option?.kind === 'brand') {
      setText('');
      navigate(`/search?brand=${encodeURIComponent(option.value)}`);
      return;
    }
    const query = option ? option.value : typed;
    setText(query);
    navigate(query ? `/search?q=${encodeURIComponent(query)}` : '/search');
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowDown' && options.length > 0) {
      event.preventDefault();
      setActive((current) => (current + 1) % options.length);
    } else if (event.key === 'ArrowUp' && options.length > 0) {
      event.preventDefault();
      setActive((current) => (current <= 0 ? options.length - 1 : current - 1));
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    go(active >= 0 ? options[active] : null);
  }

  return (
    <form role="search" onSubmit={handleSubmit} className={`relative ${className}`}>
      <label htmlFor={`${listId}-input`} className="sr-only">
        Search listings
      </label>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
        <SearchIcon />
      </span>
      <input
        id={`${listId}-input`}
        type="search"
        role="combobox"
        autoComplete="off"
        placeholder="Search kurtas, lehengas, brands…"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 && expanded ? `${listId}-${active}` : undefined}
        value={text}
        maxLength={100}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
        }}
        onKeyDown={handleKeyDown}
        className="block min-h-10 w-full rounded-full border border-line-strong bg-surface pl-10 pr-4 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 sm:text-sm"
      />
      {expanded ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Suggestions"
          className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-card border border-line bg-surface py-1 shadow-card"
        >
          {options.map((option, index) => (
            <li
              key={`${option.kind}-${option.value}`}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              // Pick on mouse down, before the input loses focus and closes the list.
              onMouseDown={(event) => {
                event.preventDefault();
                go(option);
              }}
              onMouseEnter={() => setActive(index)}
              className={`flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-sm ${
                index === active ? 'bg-accent-soft' : ''
              }`}
            >
              <span className="min-w-0 truncate text-ink">{option.value}</span>
              <span className="shrink-0 text-xs text-muted">{KIND_LABEL[option.kind]}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
