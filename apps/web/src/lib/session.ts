import type {
  SessionInfo,
  SessionResponse,
  SignInInput,
  SignUpInput,
  SwitchRoleInput,
} from "@cloudlearn/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import { api } from "./api";

export const SESSION_KEY = ["session"] as const;

export function useSession() {
  return useQuery({ queryKey: SESSION_KEY, queryFn: api.session, staleTime: 60_000 });
}

/**
 * The console layout provides the signed-in session here. Reading it from context (rather than the
 * query) means pages never see a half-signed-out state while the layout redirects to sign-in.
 */
export const SessionContext = createContext<SessionInfo | null>(null);

export function useRequiredSession(): SessionInfo {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useRequiredSession must be used inside the console layout");
  return session;
}

function useSessionMutation<I>(
  fn: (input: I) => Promise<{ session: SessionInfo } | SessionResponse>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result) => {
      const next: SessionResponse =
        "session" in result ? { signedIn: true, session: result.session } : { signedIn: false };
      queryClient.setQueryData<SessionResponse>(SESSION_KEY, next);
      // Everything else cached belonged to the previous identity, so drop it.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== SESSION_KEY[0] });
    },
  });
}

export const useSignIn = () => useSessionMutation((input: SignInInput) => api.signIn(input));
export const useSignUp = () => useSessionMutation((input: SignUpInput) => api.signUp(input));
export const useSignOut = () => useSessionMutation((_: undefined) => api.signOut());
export const useSwitchRole = () =>
  useSessionMutation((input: SwitchRoleInput) => api.switchRole(input));
export const useSwitchBack = () => useSessionMutation((_: undefined) => api.switchBack());
