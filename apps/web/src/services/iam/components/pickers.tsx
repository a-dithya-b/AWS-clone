import { useState } from "react";
import { Link } from "react-router";
import { DataTable } from "@/components/DataTable";
import { Select } from "@/components/ui/controls";
import { Badge } from "@/components/ui/feedback";
import { policyPath, useGroups, usePolicies, useUsers } from "../api";
import type { IamPolicy } from "../types";

export function PolicyTypeBadge({ scope }: { scope: "AWS" | "Local" }) {
  return scope === "AWS" ? (
    <Badge>AWS managed</Badge>
  ) : (
    <Badge variant="brand">Customer managed</Badge>
  );
}

/** Pick managed policies (by ARN) from a searchable, filterable table. */
export function PolicyPicker({
  selected,
  onChange,
  exclude = [],
}: {
  selected: string[];
  onChange: (arns: string[]) => void;
  exclude?: string[];
}) {
  const [scope, setScope] = useState<"All" | "AWS" | "Local">("All");
  const policies = usePolicies();
  const rows = policies.data?.Policies.filter(
    (p) => !exclude.includes(p.Arn) && (scope === "All" || p.Scope === scope),
  );
  return (
    <DataTable<IamPolicy>
      bare
      rows={rows}
      isLoading={policies.isPending}
      error={policies.error}
      getRowId={(p) => p.Arn}
      selectionMode="multi"
      selected={selected}
      onSelectedChange={onChange}
      filterText={(p) => `${p.PolicyName} ${p.Description}`}
      filterPlaceholder="Search policies"
      toolbar={
        <Select
          aria-label="Policy type"
          className="w-auto"
          value={scope}
          onChange={(e) => setScope(e.target.value as typeof scope)}
        >
          <option value="All">All types</option>
          <option value="AWS">AWS managed</option>
          <option value="Local">Customer managed</option>
        </Select>
      }
      emptyMessage="No policies to attach."
      columns={[
        {
          key: "name",
          header: "Policy name",
          cell: (p) => (
            <Link
              to={policyPath(p.Arn)}
              target="_blank"
              className="font-medium text-brand hover:underline"
            >
              {p.PolicyName}
            </Link>
          ),
        },
        { key: "type", header: "Type", cell: (p) => <PolicyTypeBadge scope={p.Scope} /> },
        {
          key: "desc",
          header: "Description",
          hideOnMobile: true,
          cell: (p) => <span className="text-muted">{p.Description}</span>,
        },
      ]}
    />
  );
}

/** Pick IAM groups by name. */
export function GroupPicker({
  selected,
  onChange,
  exclude = [],
}: {
  selected: string[];
  onChange: (names: string[]) => void;
  exclude?: string[];
}) {
  const groups = useGroups();
  return (
    <DataTable
      bare
      rows={groups.data?.Groups.filter((g) => !exclude.includes(g.GroupName))}
      isLoading={groups.isPending}
      error={groups.error}
      getRowId={(g) => g.GroupName}
      selectionMode="multi"
      selected={selected}
      onSelectedChange={onChange}
      filterText={(g) => g.GroupName}
      filterPlaceholder="Search groups"
      emptyMessage={
        <>
          No groups yet.{" "}
          <Link to="/iam/groups/create" className="text-brand hover:underline">
            Create a group
          </Link>
          .
        </>
      }
      columns={[
        {
          key: "name",
          header: "Group name",
          cell: (g) => <span className="font-medium">{g.GroupName}</span>,
        },
        { key: "users", header: "Users", cell: (g) => g.UserCount },
        { key: "policies", header: "Policies", cell: (g) => g.PolicyCount },
      ]}
    />
  );
}

/** Pick IAM users by name. */
export function UserPicker({
  selected,
  onChange,
  exclude = [],
  single,
}: {
  selected: string[];
  onChange: (names: string[]) => void;
  exclude?: string[];
  single?: boolean;
}) {
  const users = useUsers();
  return (
    <DataTable
      bare
      rows={users.data?.Users.filter((u) => !exclude.includes(u.UserName))}
      isLoading={users.isPending}
      error={users.error}
      getRowId={(u) => u.UserName}
      selectionMode={single ? "single" : "multi"}
      selected={selected}
      onSelectedChange={onChange}
      filterText={(u) => u.UserName}
      filterPlaceholder="Search users"
      emptyMessage="No users yet."
      columns={[
        {
          key: "name",
          header: "User name",
          cell: (u) => <span className="font-medium">{u.UserName}</span>,
        },
        { key: "groups", header: "Groups", cell: (u) => u.GroupCount },
      ]}
    />
  );
}
