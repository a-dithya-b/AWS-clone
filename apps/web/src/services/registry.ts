import { HardDrive, Inbox, KeyRound, type LucideIcon, ScrollText, Server } from "lucide-react";
import type { ComponentType } from "react";

export type ServiceCategory =
  | "Security, Identity & Compliance"
  | "Application Integration"
  | "Management & Governance"
  | "Storage"
  | "Compute";

export interface ServiceManifest {
  /** Matches the server module id and the URL: /sqs/... */
  id: string;
  name: string;
  shortName: string;
  category: ServiceCategory;
  description: string;
  icon: LucideIcon;
  status: "available" | "coming-soon";
  /** For coming-soon services: when it arrives and what learners will practice. */
  roadmap?: { phase: string; learn: string[] };
  /** Lazy-loaded route bundle. Its default export renders the service's <Routes>. */
  load?: () => Promise<{ default: ComponentType }>;
}

/** Every service in the console. Adding a service = a new folder + one entry here. */
export const services: ServiceManifest[] = [
  {
    id: "iam",
    name: "Identity and Access Management",
    shortName: "IAM",
    category: "Security, Identity & Compliance",
    description: "Users, groups, roles and the policies that decide who can do what.",
    icon: KeyRound,
    status: "coming-soon",
    roadmap: {
      phase: "Phase 2",
      learn: [
        "Create IAM users and groups, and sign in as them",
        "Write policy JSON and watch it allow or deny real API calls",
        "See why explicit Deny always wins",
        "Switch into roles with trust policies",
      ],
    },
  },
  {
    id: "sqs",
    name: "Simple Queue Service",
    shortName: "SQS",
    category: "Application Integration",
    description: "Message queues, with a live view of messages moving through them.",
    icon: Inbox,
    status: "coming-soon",
    roadmap: {
      phase: "Phase 3",
      learn: [
        "Create Standard and FIFO queues",
        "Send, receive and delete messages",
        "Watch visibility timeouts hide and release messages",
        "Route failing messages to a dead-letter queue",
      ],
    },
  },
  {
    id: "cloudtrail",
    name: "CloudTrail",
    shortName: "CloudTrail",
    category: "Management & Governance",
    description: "A history of every API call in your account, and why it was allowed or denied.",
    icon: ScrollText,
    status: "available",
    load: () => import("./cloudtrail/routes"),
  },
  {
    id: "s3",
    name: "Simple Storage Service",
    shortName: "S3",
    category: "Storage",
    description: "Buckets and objects, with bucket policies and public access controls.",
    icon: HardDrive,
    status: "coming-soon",
    roadmap: {
      phase: "Phase 5",
      learn: ["Create buckets and upload objects", "Write bucket policies", "Block public access"],
    },
  },
  {
    id: "ec2",
    name: "Elastic Compute Cloud",
    shortName: "EC2",
    category: "Compute",
    description: "Simulated virtual servers, key pairs and security groups.",
    icon: Server,
    status: "coming-soon",
    roadmap: {
      phase: "Phase 5",
      learn: ["Launch and stop instances", "Open ports with security groups", "Use key pairs"],
    },
  },
];

export const categoryColors: Record<ServiceCategory, string> = {
  "Security, Identity & Compliance": "bg-rose-600",
  "Application Integration": "bg-fuchsia-600",
  "Management & Governance": "bg-sky-600",
  Storage: "bg-emerald-600",
  Compute: "bg-amber-600",
};

export const findService = (id: string) => services.find((s) => s.id === id);
