import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, type RouteObject, RouterProvider } from "react-router";
import { Spinner } from "./components/ui/feedback";
import { ApiError } from "./lib/api";
import { SESSION_KEY, useSession } from "./lib/session";
import { SignInPage } from "./pages/auth/SignInPage";
import { SignUpPage } from "./pages/auth/SignUpPage";
import { ComingSoonPage } from "./pages/ComingSoonPage";
import { ConsoleHomePage } from "./pages/ConsoleHomePage";
import { NotFoundPage, RouteErrorPage } from "./pages/NotFoundPage";
import { services } from "./services/registry";
import { ConsoleLayout } from "./shell/ConsoleLayout";
import "./styles.css";

// If any call says "not signed in" (e.g. the session expired), update the session so the
// console layout redirects to the sign-in page.
const onError = (error: Error) => {
  if (
    error instanceof ApiError &&
    error.status === 401 &&
    error.code === "MissingAuthenticationToken"
  ) {
    queryClient.setQueryData(SESSION_KEY, { signedIn: false });
  }
};

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      // Don't retry permission or validation errors; they won't fix themselves.
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
});

function RootRedirect() {
  const session = useSession();
  if (session.isPending) return <Spinner className="m-6" />;
  return <Navigate to={session.data?.signedIn ? "/console" : "/signin"} replace />;
}

// Each service's routes come from the registry. Available services load their bundle lazily.
const serviceRoutes: RouteObject[] = services.map((s) => {
  const load = s.load;
  return load
    ? { path: `${s.id}/*`, lazy: async () => ({ Component: (await load()).default }) }
    : { path: `${s.id}/*`, element: <ComingSoonPage service={s} /> };
});

const router = createBrowserRouter([
  { path: "/", element: <RootRedirect /> },
  { path: "/signin", element: <SignInPage /> },
  { path: "/signup", element: <SignUpPage /> },
  {
    element: <ConsoleLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        errorElement: <RouteErrorPage />,
        children: [
          { path: "console", element: <ConsoleHomePage /> },
          ...serviceRoutes,
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
