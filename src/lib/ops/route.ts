import { NextResponse } from "next/server";

import { revalidateDashboardCaches } from "@/lib/cache";
import { DomainValidationError } from "@/lib/domain/validation";
import { authorizeOpsRequest } from "@/lib/ops/auth";
import { parseOpsRunFlags } from "@/lib/ops/query";
import { triggerManualOpsRun, type OpsTriggerDependencies } from "@/lib/ops/trigger";
import type { OpsTarget } from "@/lib/ops/types";

interface CreateOpsRouteOptions {
  target: OpsTarget;
  cronSecret?: string;
  triggerDependencies?: OpsTriggerDependencies;
  revalidateCaches?: (target: OpsTarget) => void | Promise<void>;
}

export function createOpsRouteHandler(options: CreateOpsRouteOptions) {
  return async function GET(request: Request): Promise<NextResponse> {
    const authResult = authorizeOpsRequest(request, options.cronSecret ?? process.env.CRON_SECRET);
    if (!authResult.ok) {
      return NextResponse.json(
        {
          error: authResult.error
        },
        {
          status: authResult.status
        }
      );
    }

    try {
      const url = new URL(request.url);
      const flags = parseOpsRunFlags(url.searchParams);
      const response = await triggerManualOpsRun(options.target, flags, options.triggerDependencies);
      const revalidateCaches = options.revalidateCaches ?? revalidateDashboardCaches;

      if (!flags.dryRun && response.status.state !== "failed") {
        try {
          await revalidateCaches(options.target);
        } catch (error) {
          const revalidateMessage = error instanceof Error ? error.message : "Unknown cache revalidation failure";
          response.status.warnings = [...response.status.warnings, `Cache revalidation skipped: ${revalidateMessage}`];
        }
      }

      return NextResponse.json(response, {
        status: 200
      });
    } catch (error: unknown) {
      if (error instanceof DomainValidationError) {
        return NextResponse.json(
          {
            error: {
              code: "invalid_query",
              message: error.message
            }
          },
          {
            status: 400
          }
        );
      }

      return NextResponse.json(
        {
          error: {
            code: "ops_trigger_failed",
            message: error instanceof Error ? error.message : "Unknown manual trigger failure"
          }
        },
        {
          status: 500
        }
      );
    }
  };
}
