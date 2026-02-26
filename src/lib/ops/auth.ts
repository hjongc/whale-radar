export interface OpsAuthResult {
  ok: boolean;
  status: 200 | 401;
  error?: {
    code: "unauthorized" | "misconfigured";
    message: string;
  };
}

function parseBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.trim().split(/\s+/, 2);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return token;
}

export function authorizeOpsRequest(request: Request, expectedSecret: string | undefined): OpsAuthResult {
  if (!expectedSecret || expectedSecret.trim().length === 0) {
    return {
      ok: false,
      status: 401,
      error: {
        code: "misconfigured",
        message: "CRON_SECRET is not configured on this deployment."
      }
    };
  }

  const bearerToken = parseBearerToken(request.headers.get("authorization"));
  const headerSecret = request.headers.get("x-cron-secret");
  const providedSecret = bearerToken ?? headerSecret;

  if (providedSecret === expectedSecret) {
    return { ok: true, status: 200 };
  }

  return {
    ok: false,
    status: 401,
    error: {
      code: "unauthorized",
      message: "Unauthorized ops trigger request."
    }
  };
}
