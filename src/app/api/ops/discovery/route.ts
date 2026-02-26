import { createOpsRouteHandler } from "@/lib/ops/route";

export const GET = createOpsRouteHandler({
  target: "discovery"
});
