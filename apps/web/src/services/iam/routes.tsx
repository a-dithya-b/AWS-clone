import { Route, Routes } from "react-router";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { ServiceLayout } from "@/shell/ServiceLayout";
import { findService } from "../registry";
import { CreateUserPage } from "./pages/CreateUser";
import { IamDashboard } from "./pages/Dashboard";
import { CreateGroupPage, GroupDetailPage, GroupsPage } from "./pages/Groups";
import { CreatePolicyPage, PoliciesPage, PolicyDetailPage } from "./pages/Policies";
import { CreateRolePage, RoleDetailPage, RolesPage } from "./pages/Roles";
import { SimulatorPage } from "./pages/Simulator";
import { UserDetailPage } from "./pages/UserDetail";
import { UsersPage } from "./pages/Users";

const sections = [
  { items: [{ label: "Dashboard", to: "", end: true }] },
  {
    title: "Access management",
    items: [
      { label: "User groups", to: "groups" },
      { label: "Users", to: "users" },
      { label: "Roles", to: "roles" },
      { label: "Policies", to: "policies" },
    ],
  },
  { title: "Tools", items: [{ label: "Policy simulator", to: "simulator" }] },
];

/** The IAM console, loaded only when someone opens /iam. */
export default function IamRoutes() {
  const service = findService("iam");
  if (!service) return null;
  return (
    <ServiceLayout service={service} sections={sections}>
      <Routes>
        <Route index element={<IamDashboard />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="users/create" element={<CreateUserPage />} />
        <Route path="users/:name" element={<UserDetailPage />} />
        <Route path="groups" element={<GroupsPage />} />
        <Route path="groups/create" element={<CreateGroupPage />} />
        <Route path="groups/:name" element={<GroupDetailPage />} />
        <Route path="roles" element={<RolesPage />} />
        <Route path="roles/create" element={<CreateRolePage />} />
        <Route path="roles/:name" element={<RoleDetailPage />} />
        <Route path="policies" element={<PoliciesPage />} />
        <Route path="policies/create" element={<CreatePolicyPage />} />
        <Route path="policies/*" element={<PolicyDetailPage />} />
        <Route path="simulator" element={<SimulatorPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </ServiceLayout>
  );
}
