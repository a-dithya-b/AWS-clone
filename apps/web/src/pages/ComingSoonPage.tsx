import { CircleDashed } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ServiceIcon } from "@/components/ServiceIcon";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/feedback";
import { useTitle } from "@/lib/useTitle";
import type { ServiceManifest } from "@/services/registry";

export function ComingSoonPage({ service }: { service: ServiceManifest }) {
  useTitle(service.shortName);
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <PageHeader
        crumbs={[{ label: "Console Home", to: "/console" }, { label: service.shortName }]}
        title={
          <span className="flex items-center gap-3">
            <ServiceIcon service={service} size="lg" />
            {service.name}
          </span>
        }
      />
      <Card>
        <CardBody className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge variant="brand">Coming in {service.roadmap?.phase ?? "a later phase"}</Badge>
          </div>
          <p className="text-sm text-fg">{service.description}</p>
          {service.roadmap && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-fg">What you'll practice</h2>
              <ul className="space-y-2">
                {service.roadmap.learn.map((item) => (
                  <li key={item} className="flex gap-2 text-sm text-muted">
                    <CircleDashed className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
