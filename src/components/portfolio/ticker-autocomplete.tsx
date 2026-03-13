"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

interface SearchResult {
  symbol: string;
  name: string;
  exchange?: string | null;
  description?: string | null;
  assetType?: string | null;
}

interface Props {
  value: string;
  onSelect: (symbol: string) => void;
  onValidityChange?: (isValid: boolean) => void;
  invalid?: boolean;
}

export function TickerAutocomplete({ value, onSelect, onValidityChange, invalid = false }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const queryRef = useRef<string>(value);
  const valueRef = useRef<string>(value);
  const onValidityChangeRef = useRef<typeof onValidityChange>(onValidityChange);
  const hasFocusRef = useRef<boolean>(false);
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const debounced = useMemo(() => query.trim(), [query]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!debounced) {
        setResults([]);
        return;
      }

      setLoading(true);
      try {
        const res = await fetch(`/api/search?query=${encodeURIComponent(debounced)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { results: SearchResult[] };
        setResults(data.results ?? []);
        if (hasFocusRef.current) {
          setOpen(true);
        }
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [debounced]);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    onValidityChangeRef.current = onValidityChange;
  }, [onValidityChange]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        const q = queryRef.current.trim().toUpperCase();
        const v = valueRef.current.trim().toUpperCase();
        const isValid = q === v && v.length > 0;
        onValidityChangeRef.current?.(isValid);
        setOpen(false);
        hasFocusRef.current = false;
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <Input
        className={invalid ? "border-red-300 bg-red-50/60 focus-visible:ring-red-300" : ""}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value.toUpperCase());
          onValidityChange?.(false);
        }}
        onFocus={() => {
          hasFocusRef.current = true;
          setOpen(true);
        }}
        onBlur={() => {
          hasFocusRef.current = false;
          const isValid = query.trim().toUpperCase() === value.trim().toUpperCase() && value.trim().length > 0;
          onValidityChange?.(isValid);
        }}
        placeholder="Ticker (e.g. VTI)"
      />
      {invalid ? <p className="mt-1 text-xs text-red-600">Invalid ticker. Select one from the dropdown.</p> : null}
      {open ? (
        <div className="absolute z-30 mt-2 max-h-56 w-full overflow-auto rounded-xl border border-border bg-white p-1 shadow-soft">
          {loading ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">Searching...</div>
          ) : !query.trim() ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">Type ticker or company name</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">No results</div>
          ) : (
            results.map((result, index) => (
              <button
                key={`${result.symbol}-${result.exchange}-${result.name}-${index}`}
                className="flex w-full flex-col rounded-lg px-3 py-2 text-left hover:bg-slate-100"
                onClick={() => {
                  setQuery(result.symbol);
                  onSelect(result.symbol);
                  onValidityChange?.(true);
                  setOpen(false);
                }}
                type="button"
              >
                <span className="text-sm font-medium">{result.symbol}</span>
                <span className="text-xs text-muted-foreground">
                  {[result.name, result.exchange].filter(Boolean).join(" - ")}
                </span>
                {result.description ? (
                  <span className="mt-0.5 text-[11px] leading-snug text-slate-500">
                    {result.description.length > 110 ? `${result.description.slice(0, 110)}...` : result.description}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
