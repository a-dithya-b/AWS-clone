import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { Button } from "@/components/ui/button";
import { useTitle } from "@/lib/useTitle";

export function NotFoundPage() {
  useTitle("Page not found");
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <p className="text-sm font-medium text-brand">404</p>
      <h1 className="mt-2 text-2xl font-semibold text-fg">Page not found</h1>
      <p className="mt-2 text-sm text-muted">This page doesn't exist in CloudLearn (yet).</p>
      <Button asChild className="mt-6">
        <Link to="/console">Back to Console Home</Link>
      </Button>
    </div>
  );
}

/** Shown when a page crashes or a lazy service bundle fails to load. */
export function RouteErrorPage() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "Unknown error";
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold text-fg">Something went wrong</h1>
      <p className="mt-2 font-mono text-sm break-words text-muted">{message}</p>
      <Button className="mt-6" onClick={() => window.location.reload()}>
        Reload
      </Button>
    </div>
  );
}
