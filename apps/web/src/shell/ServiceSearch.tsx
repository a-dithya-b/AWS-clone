import { Search } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ServiceIcon } from "@/components/ServiceIcon";
import { cn } from "@/lib/cn";
import { type ServiceManifest, services } from "@/services/registry";

function matches(service: ServiceManifest, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return [service.shortName, service.name, service.description].some((t) =>
    t.toLowerCase().includes(q),
  );
}

/** The top-bar service search. Type, use the arrow keys, press Enter to open a service. */
export function ServiceSearch() {
  const navigate = useNavigate();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const results = useMemo(() => services.filter((s) => matches(s, query)), [query]);
  const showList = open && query.trim().length > 0;

  const go = (service: ServiceManifest | undefined) => {
    if (!service) return;
    navigate(`/${service.id}`);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-topbar-muted" />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Search services"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
        placeholder="Search services"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            go(results[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="h-8 w-full rounded-md border border-white/15 bg-white/10 pr-3 pl-8 text-sm text-topbar-fg placeholder:text-topbar-muted focus:bg-white focus:text-fg focus:placeholder:text-muted"
      />
      {showList && (
        <div
          id={listId}
          role="listbox"
          className="absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-md border border-border bg-surface py-1 shadow-lg"
        >
          {results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted">No services match “{query}”.</p>
          ) : (
            results.map((s, i) => (
              <div
                key={s.id}
                id={`${listId}-${i}`}
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(s);
                }}
                className={cn(
                  "flex cursor-pointer items-center gap-3 px-3 py-2",
                  i === active && "bg-brand-soft",
                )}
              >
                <ServiceIcon service={s} size="sm" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">
                    {s.shortName}
                    {s.shortName !== s.name && (
                      <span className="font-normal text-muted"> · {s.name}</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted">{s.description}</p>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
