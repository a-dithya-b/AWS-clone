import { ChevronDown, LogOut } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useNavigate } from "react-router";
import { CopyButton } from "@/components/CopyButton";
import { useRequiredSession, useSignOut } from "@/lib/session";

const principalLabel = { root: "Root user", user: "IAM user", "assumed-role": "Assumed role" };

/** Shows who you are signed in as, like the console's account menu (name @ account). */
export function AccountMenu() {
  const session = useRequiredSession();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const { principal } = session;
  const accountLabel = session.accountAlias ?? session.accountId;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="inline-flex h-8 max-w-[45vw] min-w-0 cursor-pointer sm:max-w-64 items-center gap-1 rounded-md px-2.5 text-sm text-topbar-fg hover:bg-topbar-hover data-[state=open]:bg-topbar-hover">
        <span className="truncate">
          {principal.name}{" "}
          <span className="hidden text-topbar-muted sm:inline">@ {accountLabel}</span>
        </span>
        <ChevronDown className="size-4 shrink-0" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-80 rounded-lg border border-border bg-surface p-1 text-sm shadow-xl"
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
            <div>
              <dt className="text-xs text-muted">ARN</dt>
              <dd className="flex items-start gap-1 font-mono text-xs break-all text-fg">
                {principal.arn}
                <CopyButton value={principal.arn} label="ARN" />
              </dd>
            </div>
          </dl>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-fg outline-none data-[highlighted]:bg-surface-muted"
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
