import { Tabs as RadixTabs } from "radix-ui";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router";
import { cn } from "@/lib/cn";

export interface TabDef {
  id: string;
  label: ReactNode;
  content: ReactNode;
}

/**
 * Tabs. With `urlParam`, the selected tab is kept in the query string (e.g. ?tab=groups), so it
 * survives reloads and can be linked to.
 */
export function Tabs({
  tabs,
  urlParam,
  defaultTab,
  className,
}: {
  tabs: TabDef[];
  urlParam?: string;
  defaultTab?: string;
  className?: string;
}) {
  const [params, setParams] = useSearchParams();
  const fallback = defaultTab ?? tabs[0]?.id ?? "";
  const fromUrl = urlParam ? params.get(urlParam) : null;
  const value = fromUrl && tabs.some((t) => t.id === fromUrl) ? fromUrl : undefined;

  return (
    <RadixTabs.Root
      className={className}
      defaultValue={fallback}
      {...(urlParam
        ? {
            value: value ?? fallback,
            onValueChange: (v: string) =>
              setParams(
                (p) => {
                  p.set(urlParam, v);
                  return p;
                },
                { replace: true },
              ),
          }
        : {})}
    >
      <RadixTabs.List className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((t) => (
          <RadixTabs.Trigger
            key={t.id}
            value={t.id}
            className={cn(
              "-mb-px cursor-pointer border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-muted hover:text-fg",
              "data-[state=active]:border-brand data-[state=active]:text-brand",
            )}
          >
            {t.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {tabs.map((t) => (
        <RadixTabs.Content key={t.id} value={t.id} className="focus:outline-none">
          {t.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
