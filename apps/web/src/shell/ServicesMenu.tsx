import { LayoutGrid } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";
import { Link } from "react-router";
import { ServiceIcon } from "@/components/ServiceIcon";
import { Badge } from "@/components/ui/feedback";
import { type ServiceCategory, services } from "@/services/registry";

/** The "Services" menu: every service grouped by category, like the console's service menu. */
export function ServicesMenu() {
  const [open, setOpen] = useState(false);
  const byCategory = new Map<ServiceCategory, typeof services>();
  for (const s of services) byCategory.set(s.category, [...(byCategory.get(s.category) ?? []), s]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label="Services"
        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-topbar-fg hover:bg-topbar-hover data-[state=open]:bg-topbar-hover"
      >
        <LayoutGrid className="size-4" aria-hidden />
        <span className="hidden sm:inline">Services</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          className="z-50 w-[min(42rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-4 shadow-xl"
        >
          <div className="grid gap-5 sm:grid-cols-2">
            {[...byCategory].map(([category, list]) => (
              <div key={category}>
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
                  {category}
                </h3>
                <ul className="space-y-1">
                  {list.map((s) => (
                    <li key={s.id}>
                      <Link
                        to={`/${s.id}`}
                        onClick={() => setOpen(false)}
                        className="flex items-center gap-3 rounded-md p-2 hover:bg-surface-muted"
                      >
                        <ServiceIcon service={s} size="sm" />
                        <span className="min-w-0 flex-1 text-sm font-medium text-fg">
                          {s.shortName}
                        </span>
                        {s.status === "coming-soon" && <Badge>Soon</Badge>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
