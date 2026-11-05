import type { ServiceModule } from "../core/service";
import { cloudtrailService } from "./cloudtrail";
import { iamService } from "./iam";
import { sqsService } from "./sqs";
import { stsService } from "./sts";

/** Every simulated service. Adding a service = a new folder + one line here. */
export const services: ServiceModule[] = [iamService, stsService, sqsService, cloudtrailService];
