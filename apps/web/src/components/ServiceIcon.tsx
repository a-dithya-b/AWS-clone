import { cn } from "@/lib/cn";
import { categoryColors, type ServiceManifest } from "@/services/registry";

export function ServiceIcon({
  service,
  size = "md",
}: {
  service: ServiceManifest;
  size?: "sm" | "md" | "lg";
}) {
  const Icon = service.icon;
  const box = { sm: "size-6 rounded", md: "size-8 rounded-md", lg: "size-12 rounded-lg" }[size];
  const icon = { sm: "size-3.5", md: "size-4.5", lg: "size-7" }[size];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center text-white",
        box,
        categoryColors[service.category],
      )}
      aria-hidden
    >
      <Icon className={icon} />
    </span>
  );
}
