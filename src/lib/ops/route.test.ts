import { describe, expect, it, vi } from "vitest";

import { createOpsRouteHandler } from "@/lib/ops/route";

describe("ops route handler", () => {
  it("rejects unauthenticated requests", async () => {
    const handler = createOpsRouteHandler({
      target: "ingest",
      cronSecret: "task-12-secret"
    });

    const response = await handler(new Request("http://localhost:3000/api/ops/ingest?mode=manual&scope=priority"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({
      error: {
        code: "unauthorized"
      }
    });
  });

  it("returns run id and structured status for authorized trigger", async () => {
    const handler = createOpsRouteHandler({
      target: "ingest",
      cronSecret: "task-12-secret",
      triggerDependencies: {
        runIdFactory: () => "run-task-12",
        now: () => new Date("2026-02-21T15:00:00.000Z")
      }
    });

    const request = new Request(
      "http://localhost:3000/api/ops/ingest?mode=manual&scope=priority&dry-run=true&replay=false&priority-only=true",
      {
        headers: {
          Authorization: "Bearer task-12-secret"
        }
      }
    );

    const response = await handler(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.runId).toBe("run-task-12");
    expect(body.status).toMatchObject({
      state: "queued"
    });
    expect(body.flags).toEqual({
      mode: "manual",
      dryRun: true,
      replay: false,
      priorityOnly: true,
      scope: "priority"
    });
  });

  it("returns 400 for invalid query flags", async () => {
    const handler = createOpsRouteHandler({
      target: "enrichment",
      cronSecret: "task-12-secret"
    });

    const response = await handler(
      new Request("http://localhost:3000/api/ops/enrichment?dry-run=invalid", {
        headers: {
          Authorization: "Bearer task-12-secret"
        }
      })
    );

    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: {
        code: "invalid_query"
      }
    });
  });

  it("runs targeted cache revalidation for non-dry triggers", async () => {
    const revalidateCaches = vi.fn();
    const handler = createOpsRouteHandler({
      target: "ingest",
      cronSecret: "task-12-secret",
      revalidateCaches
    });

    const response = await handler(
      new Request("http://localhost:3000/api/ops/ingest?mode=manual&scope=priority&dry-run=false", {
        headers: {
          Authorization: "Bearer task-12-secret"
        }
      })
    );

    expect(response.status).toBe(200);
    expect(revalidateCaches).toHaveBeenCalledTimes(1);
    expect(revalidateCaches).toHaveBeenCalledWith("ingest");
  });
});
