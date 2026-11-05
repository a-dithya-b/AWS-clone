import { Search } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { ApiErrorAlert } from "./ApiErrorAlert";
import { Card, CardHeader } from "./ui/card";
import { Checkbox } from "./ui/controls";
import { Spinner } from "./ui/feedback";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Hide on narrow screens. */
  hideOnMobile?: boolean;
}

export interface DataTableProps<T> {
  title?: ReactNode;
  description?: ReactNode;
  /** Buttons shown in the header, e.g. Create / Delete. */
  actions?: ReactNode;
  columns: Column<T>[];
  rows: T[] | undefined;
  getRowId: (row: T) => string;
  isLoading?: boolean;
  error?: unknown;
  emptyMessage?: ReactNode;
  /** Text used by the filter box. Omit to hide the filter. */
  filterText?: (row: T) => string;
  filterPlaceholder?: string;
  /** Row selection: "multi" shows checkboxes, "single" radio buttons. */
  selectionMode?: "multi" | "single";
  selected?: string[];
  onSelectedChange?: (ids: string[]) => void;
  /** Render without the surrounding card (e.g. inside a dialog). */
  bare?: boolean;
  /** Extra content above the table (e.g. a scope filter). */
  toolbar?: ReactNode;
}

/** The console's table: header with actions, text filter, selection, and empty/loading/error states. */
export function DataTable<T>({
  title,
  description,
  actions,
  columns,
  rows,
  getRowId,
  isLoading,
  error,
  emptyMessage = "Nothing here yet.",
  filterText,
  filterPlaceholder = "Filter",
  selectionMode,
  selected = [],
  onSelectedChange,
  bare,
  toolbar,
}: DataTableProps<T>) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    if (!q || !filterText) return rows;
    return rows.filter((r) => filterText(r).toLowerCase().includes(q));
  }, [rows, query, filterText]);

  const selectedSet = new Set(selected);
  const allVisibleSelected =
    filtered.length > 0 && filtered.every((r) => selectedSet.has(getRowId(r)));
  const toggle = (id: string) => {
    if (!onSelectedChange) return;
    if (selectionMode === "single") return onSelectedChange([id]);
    onSelectedChange(selectedSet.has(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  };
  const toggleAll = () => {
    if (!onSelectedChange) return;
    const ids = filtered.map(getRowId);
    onSelectedChange(
      allVisibleSelected
        ? selected.filter((s) => !ids.includes(s))
        : [...new Set([...selected, ...ids])],
    );
  };

  const body = (
    <>
      {(filterText || toolbar) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          {filterText && (
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted" />
              <input
                type="search"
                aria-label={filterPlaceholder}
                placeholder={filterPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-surface pr-3 pl-8 text-sm text-fg shadow-xs placeholder:text-muted/70"
              />
            </div>
          )}
          {toolbar}
        </div>
      )}
      {error ? (
        <div className="p-4">
          <ApiErrorAlert error={error} />
        </div>
      ) : isLoading ? (
        <div className="p-4">
          <Spinner />
        </div>
      ) : filtered.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">
          {query ? `No matches for “${query}”.` : emptyMessage}
        </p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface-muted text-xs text-muted">
              <tr>
                {selectionMode && (
                  <th className="w-10 py-2 pl-4">
                    {selectionMode === "multi" && (
                      <Checkbox
                        aria-label="Select all"
                        checked={allVisibleSelected}
                        onChange={toggleAll}
                      />
                    )}
                  </th>
                )}
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={cn(
                      "px-4 py-2 font-medium whitespace-nowrap",
                      c.hideOnMobile && "hidden md:table-cell",
                      c.className,
                    )}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const id = getRowId(row);
                const isSelected = selectedSet.has(id);
                return (
                  <tr
                    key={id}
                    className={cn(
                      "border-b border-border last:border-b-0",
                      selectionMode && "cursor-pointer hover:bg-surface-muted",
                      isSelected && "bg-brand-soft/60",
                    )}
                    onClick={
                      selectionMode
                        ? (e) => {
                            // Let links and buttons inside the row work normally.
                            if ((e.target as HTMLElement).closest("a,button,input")) return;
                            toggle(id);
                          }
                        : undefined
                    }
                  >
                    {selectionMode && (
                      <td className="py-2 pl-4">
                        <input
                          type={selectionMode === "multi" ? "checkbox" : "radio"}
                          aria-label={`Select ${id}`}
                          checked={isSelected}
                          onChange={() => toggle(id)}
                          className="size-4 cursor-pointer accent-brand"
                        />
                      </td>
                    )}
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={cn(
                          "px-4 py-2 align-top text-fg",
                          c.hideOnMobile && "hidden md:table-cell",
                          c.className,
                        )}
                      >
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  if (bare) return <div className="overflow-hidden rounded-md border border-border">{body}</div>;

  return (
    <Card>
      {(title || actions) && (
        <CardHeader
          title={
            <>
              {title}
              {rows && <span className="ml-1.5 font-normal text-muted">({rows.length})</span>}
            </>
          }
          description={description}
          actions={actions}
        />
      )}
      {body}
    </Card>
  );
}
