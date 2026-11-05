import { Globe } from "lucide-react";
import { Tooltip } from "radix-ui";
import { Link, Navigate, Outlet, useLocation } from "react-router";
import { Logo } from "@/components/Logo";
import { Alert, Spinner } from "@/components/ui/feedback";
import { SessionContext, useSession } from "@/lib/session";
import { AccountMenu } from "./AccountMenu";
import { Footer } from "./Footer";
import { ServiceSearch } from "./ServiceSearch";
import { ServicesMenu } from "./ServicesMenu";

function TopBar() {
  return (
    <header className="sticky top-0 z-40 bg-topbar">
      <div className="flex h-12 items-center gap-2 px-3 sm:gap-3 sm:px-4">
        <Link
          to="/console"
          className="mr-1 shrink-0 rounded-md px-1"
          aria-label="CloudLearn console home"
        >
          <Logo />
        </Link>
        <ServicesMenu />
        <div className="flex min-w-0 flex-1 justify-center px-1">
          {/* On phones the Services menu is enough; the search box needs more room. */}
          <div className="hidden w-full justify-center sm:flex">
            <ServiceSearch />
          </div>
        </div>
        <Tooltip.Root>
          <Tooltip.Trigger className="hidden h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-topbar-fg hover:bg-topbar-hover md:inline-flex">
            <Globe className="size-4" aria-hidden />
            N. Virginia
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              sideOffset={6}
              className="z-50 max-w-60 rounded-md bg-fg px-3 py-2 text-xs text-white shadow-lg"
            >
              CloudLearn simulates a single region, us-east-1 (US East, N. Virginia). It appears in
              every ARN, just like in AWS.
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
        <AccountMenu />
      </div>
    </header>
  );
}

/** The signed-in console: top bar, page content, footer. Sends signed-out visitors to sign in. */
export function ConsoleLayout() {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (session.isError) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Alert variant="error" title="Can't reach the CloudLearn server">
          {session.error.message} Make sure it's running, then refresh this page.
        </Alert>
      </div>
    );
  }
  if (!session.data.signedIn) {
    const next = location.pathname + location.search;
    return <Navigate to={`/signin?next=${encodeURIComponent(next)}`} replace />;
  }

  return (
    <SessionContext.Provider value={session.data.session}>
      <Tooltip.Provider delayDuration={300}>
        <div className="flex min-h-full flex-col">
          <TopBar />
          <main className="min-w-0 flex-1">
            <Outlet />
          </main>
          <Footer />
        </div>
      </Tooltip.Provider>
    </SessionContext.Provider>
  );
}
