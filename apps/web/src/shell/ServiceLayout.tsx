import { Menu, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { ServiceIcon } from "@/components/ServiceIcon";
import { cn } from "@/lib/cn";
import type { ServiceManifest } from "@/services/registry";

export interface NavItem {
  label: string;
  /** Path relative to the service root, e.g. "users". Empty for the root page. */
  to: string;
  /** Match only the exact path (for the dashboard). */
  end?: boolean;
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

/** A service's page frame: left navigation (a menu on phones) plus the page content. */
export function ServiceLayout({
  service,
  sections,
  children,
}: {
  service: ServiceManifest;
  sections: NavSection[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const base = `/${service.id}`;

  const nav = (
    <nav aria-label={`${service.shortName} navigation`} className="space-y-5">
      {sections.map((section, i) => (
        <div key={section.title ?? i}>
          {section.title && (
            <h3 className="mb-1 px-3 text-xs font-semibold tracking-wide text-muted uppercase">
              {section.title}
            </h3>
          )}
          <ul className="space-y-0.5">
            {section.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to ? `${base}/${item.to}` : base}
                  end={item.end}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "block rounded-md px-3 py-1.5 text-sm",
                      isActive
                        ? "bg-brand-soft font-medium text-brand"
                        : "text-fg hover:bg-surface-muted",
                    )
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  const current = sections
    .flatMap((s) => s.items)
    .filter((i) => {
      const path = i.to ? `${base}/${i.to}` : base;
      return i.end ? location.pathname === path : location.pathname.startsWith(path);
    })
    .sort((a, b) => b.to.length - a.to.length)[0];

  return (
    <div className="flex min-h-full">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-surface lg:block">
        <div className="sticky top-12 max-h-[calc(100vh-3rem)] overflow-y-auto p-3">
          <Link to={base} className="mb-4 flex items-center gap-2 px-3 pt-2">
            <ServiceIcon service={service} size="sm" />
            <span className="font-semibold text-fg">{service.shortName}</span>
          </Link>
          {nav}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="border-b border-border bg-surface px-4 py-2 lg:hidden">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex w-full cursor-pointer items-center gap-2 text-sm font-medium text-fg"
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
            <ServiceIcon service={service} size="sm" />
            {service.shortName}
            {current && <span className="truncate font-normal text-muted">/ {current.label}</span>}
          </button>
          {open && <div className="pt-3 pb-1">{nav}</div>}
        </div>
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</div>
      </div>
    </div>
  );
}
