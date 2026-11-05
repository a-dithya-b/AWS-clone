import { ChevronRight } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";

export interface Crumb {
  label: string;
  to?: string;
}

/** Breadcrumbs + page title + actions, the header pattern every console page uses. */
export function PageHeader({
  title,
  description,
  crumbs,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  crumbs?: Crumb[];
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-muted">
            {crumbs.map((c, i) => (
              <Fragment key={c.to ?? c.label}>
                {i > 0 && <ChevronRight className="size-3.5" aria-hidden />}
                <li>
                  {c.to ? (
                    <Link to={c.to} className="text-brand hover:underline">
                      {c.label}
                    </Link>
                  ) : (
                    <span aria-current="page">{c.label}</span>
                  )}
                </li>
              </Fragment>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
