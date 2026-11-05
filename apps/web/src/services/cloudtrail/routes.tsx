import type { LookupEventsOutput } from "@cloudlearn/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Route, Routes } from "react-router";
import { EventTable } from "@/components/EventTable";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, Spinner } from "@/components/ui/feedback";
import { api } from "@/lib/api";
import { useTitle } from "@/lib/useTitle";
import { NotFoundPage } from "@/pages/NotFoundPage";

function EventHistoryPage() {
  useTitle("Event history");
  const query = useInfiniteQuery({
    queryKey: ["cloudtrail", "LookupEvents", "history"],
    queryFn: ({ pageParam }) =>
      api.action<LookupEventsOutput>("cloudtrail", "LookupEvents", {
        MaxResults: 50,
        ...(pageParam ? { NextToken: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.NextToken,
  });
  const events = query.data?.pages.flatMap((p) => p.Events) ?? [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <PageHeader
        crumbs={[{ label: "CloudTrail", to: "/cloudtrail" }, { label: "Event history" }]}
        title="Event history"
        description="Every API call made in this account, newest first. Open an event to see which identity made it, what it targeted, and why IAM allowed or denied it."
        actions={
          <Button variant="secondary" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RefreshCw className="size-4" aria-hidden /> Refresh
          </Button>
        }
      />
      <Card>
        {query.isPending ? (
          <div className="p-5">
            <Spinner />
          </div>
        ) : query.isError ? (
          <div className="p-5">
            <Alert variant="error">{query.error.message}</Alert>
          </div>
        ) : events.length === 0 ? (
          <p className="p-5 text-sm text-muted">No events yet.</p>
        ) : (
          <>
            <EventTable events={events} />
            {query.hasNextPage && (
              <div className="p-3 text-center">
                <Button
                  variant="secondary"
                  onClick={() => query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                >
                  {query.isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

/** The CloudTrail route bundle, loaded only when someone opens /cloudtrail. */
export default function CloudTrailRoutes() {
  return (
    <Routes>
      <Route index element={<EventHistoryPage />} />
      <Route path="events" element={<EventHistoryPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
