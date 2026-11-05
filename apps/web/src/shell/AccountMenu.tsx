import { ArrowLeftRight, ChevronDown, LogOut, Undo2 } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useNavigate } from "react-router";
import { CopyButton } from "@/components/CopyButton";
import { formatDateTime } from "@/lib/format";
import { useRequiredSession, useSignOut, useSwitchBack } from "@/lib/session";

const principalLabel = { root: "Root user", user: "IAM user", "assumed-role": "Assumed role" };

const itemClass =
  "flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-fg outline-none data-[highlighted]:bg-surface-muted";

/** Shows who you are signed in as, like the console's account menu (name @ account). */
export function AccountMenu() {
  const session = useRequiredSession();
  const signOut = useSignOut();
  const switchBack = useSwitchBack();
  const navigate = useNavigate();
  const { principal } = session;
  const accountLabel = session.accountAlias ?? session.accountId;
  const inRole = principal.type === "assumed-role";
  // Role sessions are named "Role/session"; the top bar shows just the role, like the console.
  const shortName = inRole ? (principal.name.split("/")[0] ?? principal.name) : principal.name;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="inline-flex h-8 max-w-[45vw] min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm text-topbar-fg hover:bg-topbar-hover data-[state=open]:bg-topbar-hover sm:max-w-72">
        {inRole && (
          <span className="shrink-0 rounded bg-amber-400 px-1.5 py-0.5 text-xs font-semibold text-amber-950">
            Role
          </span>
        )}
        <span className="truncate">
          {shortName} <span className="hidden text-topbar-muted sm:inline">@ {accountLabel}</span>
        </span>
        <ChevronDown className="size-4 shrink-0" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-80 max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-surface p-1 text-sm shadow-xl"
        >
          <dl className="space-y-3 px-3 py-3">
            <div>
              <dt className="text-xs text-muted">Account ID</dt>
              <dd className="flex items-center gap-1 font-mono text-fg">
                {session.accountId}
                <CopyButton value={session.accountId} label="account ID" />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Signed in as</dt>
              <dd className="text-fg">
                {principalLabel[principal.type]} · {principal.name}
              </dd>
            </div>
            {session.switchedFrom && (
              <div>
                <dt className="text-xs text-muted">Switched from</dt>
                <dd className="text-fg">
                  {session.switchedFrom.principalName}{" "}
                  <span className="text-muted">@ {session.switchedFrom.accountId}</span>
                </dd>
              </div>
            )}
            {inRole && (
              <div>
                <dt className="text-xs text-muted">Role session expires</dt>
                <dd className="text-fg">{formatDateTime(session.expiresAt)}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-muted">ARN</dt>
              <dd className="flex items-start gap-1 font-mono text-xs break-all text-fg">
                {principal.arn}
                <CopyButton value={principal.arn} label="ARN" />
              </dd>
            </div>
          </dl>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          {principal.type === "user" && (
            <DropdownMenu.Item className={itemClass} onSelect={() => navigate("/switchrole")}>
              <ArrowLeftRight className="size-4" aria-hidden />
              Switch role
            </DropdownMenu.Item>
          )}
          {inRole && (
            <DropdownMenu.Item
              className={itemClass}
              onSelect={() =>
                switchBack.mutate(undefined, { onSuccess: () => navigate("/console") })
              }
            >
              <Undo2 className="size-4" aria-hidden />
              Switch back{session.switchedFrom ? ` to ${session.switchedFrom.principalName}` : ""}
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item
            className={itemClass}
            onSelect={() => signOut.mutate(undefined, { onSuccess: () => navigate("/signin") })}
          >
            <LogOut className="size-4" aria-hidden />
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
