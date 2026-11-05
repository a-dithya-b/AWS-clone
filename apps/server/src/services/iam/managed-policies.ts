import type { PolicyDocument } from "@cloudlearn/iam-engine";

export interface ManagedPolicySeed {
  name: string;
  description: string;
  document: PolicyDocument;
}

/**
 * AWS-managed policies, shared by every account. Documents follow the real AWS policies; a few
 * are trimmed to the services CloudLearn simulates (noted in the description).
 */
export const awsManagedPolicies: ManagedPolicySeed[] = [
  {
    name: "AdministratorAccess",
    description: "Provides full access to AWS services and resources.",
    document: {
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Action: "*", Resource: "*" }],
    },
  },
  {
    name: "PowerUserAccess",
    description:
      "Provides full access to AWS services and resources, but does not allow management of users and groups.",
    document: {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          NotAction: ["iam:*", "organizations:*", "account:*"],
          Resource: "*",
        },
        {
          Effect: "Allow",
          Action: [
            "iam:CreateServiceLinkedRole",
            "iam:DeleteServiceLinkedRole",
            "iam:ListRoles",
            "organizations:DescribeOrganization",
            "account:ListRegions",
            "account:GetAccountInformation",
          ],
          Resource: "*",
        },
      ],
    },
  },
  {
    name: "ReadOnlyAccess",
    description:
      "Provides read-only access to AWS services and resources. (Trimmed to the services CloudLearn simulates.)",
    document: {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "cloudtrail:Describe*",
            "cloudtrail:Get*",
            "cloudtrail:List*",
            "cloudtrail:LookupEvents",
            "ec2:Describe*",
            "ec2:Get*",
            "iam:Generate*",
            "iam:Get*",
            "iam:List*",
            "iam:Simulate*",
            "s3:Get*",
            "s3:List*",
            "sqs:Get*",
            "sqs:List*",
            "sts:GetCallerIdentity",
          ],
          Resource: "*",
        },
      ],
    },
  },
  {
    name: "IAMFullAccess",
    description: "Provides full access to IAM via the AWS Management Console.",
    document: {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "iam:*",
            "organizations:DescribeAccount",
            "organizations:DescribeOrganization",
            "organizations:DescribeOrganizationalUnit",
            "organizations:DescribePolicy",
            "organizations:ListChildren",
            "organizations:ListParents",
            "organizations:ListPoliciesForTarget",
            "organizations:ListRoots",
            "organizations:ListPolicies",
            "organizations:ListTargetsForPolicy",
          ],
          Resource: "*",
        },
      ],
    },
  },
  {
    name: "IAMReadOnlyAccess",
    description: "Provides read only access to IAM via the AWS Management Console.",
    document: {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "iam:GenerateCredentialReport",
            "iam:GenerateServiceLastAccessedDetails",
            "iam:Get*",
            "iam:List*",
            "iam:SimulateCustomPolicy",
            "iam:SimulatePrincipalPolicy",
          ],
          Resource: "*",
        },
      ],
    },
  },
  {
    name: "IAMUserChangePassword",
    description: "Provides the ability for an IAM user to change their own password.",
    document: {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["iam:ChangePassword"],
          Resource: ["arn:aws:iam::*:user/${aws:username}"],
        },
        { Effect: "Allow", Action: ["iam:GetAccountPasswordPolicy"], Resource: "*" },
      ],
    },
  },
  {
    name: "AmazonSQSFullAccess",
    description: "Provides full access to Amazon SQS via the AWS Management Console.",
    document: {
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Action: ["sqs:*"], Resource: "*" }],
    },
  },
  {
    name: "AmazonSQSReadOnlyAccess",
    description: "Provides read only access to Amazon SQS via the AWS Management Console.",
    document: {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "sqs:GetQueueAttributes",
            "sqs:GetQueueUrl",
            "sqs:ListDeadLetterSourceQueues",
            "sqs:ListQueues",
            "sqs:ListMessageMoveTasks",
            "sqs:ListQueueTags",
          ],
          Resource: "*",
        },
      ],
    },
  },
  {
    name: "AmazonS3FullAccess",
    description: "Provides full access to all buckets via the AWS Management Console.",
    document: {
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Action: ["s3:*", "s3-object-lambda:*"], Resource: "*" }],
    },
  },
  {
    name: "AmazonS3ReadOnlyAccess",
    description: "Provides read only access to all buckets via the AWS Management Console.",
    document: {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "s3:Get*",
            "s3:List*",
            "s3:Describe*",
            "s3-object-lambda:Get*",
            "s3-object-lambda:List*",
          ],
          Resource: "*",
        },
      ],
    },
  },
  {
    name: "AmazonEC2FullAccess",
    description:
      "Provides full access to Amazon EC2 via the AWS Management Console. (Trimmed to EC2.)",
    document: {
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Action: "ec2:*", Resource: "*" }],
    },
  },
  {
    name: "AmazonEC2ReadOnlyAccess",
    description:
      "Provides read only access to Amazon EC2 via the AWS Management Console. (Trimmed to EC2.)",
    document: {
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Action: "ec2:Describe*", Resource: "*" }],
    },
  },
  {
    name: "AWSCloudTrail_ReadOnlyAccess",
    description: "Provides read only access to AWS CloudTrail.",
    document: {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "cloudtrail:Get*",
            "cloudtrail:Describe*",
            "cloudtrail:List*",
            "cloudtrail:LookupEvents",
          ],
          Resource: "*",
        },
      ],
    },
  },
];
