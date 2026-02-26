import { NextResponse } from "next/server";

import {
  getCachedMarketHubAggregates,
  getCachedWhaleInsiderAggregates,
  getCachedWhaleManagerDirectory,
  parseWhaleHoldingsQuery
} from "@/lib/data";

interface MarketAggregateRouteDependencies {
  getAggregates?: typeof getCachedMarketHubAggregates;
}

interface WhaleAggregateRouteDependencies {
  parseQuery?: typeof parseWhaleHoldingsQuery;
  getAggregates?: typeof getCachedWhaleInsiderAggregates;
}

interface WhaleManagerDirectoryRouteDependencies {
  getDirectory?: typeof getCachedWhaleManagerDirectory;
}

export function createMarketAggregatesRouteHandler(deps: MarketAggregateRouteDependencies = {}) {
  const getAggregates = deps.getAggregates ?? getCachedMarketHubAggregates;

  return async function GET() {
    const dto = await getAggregates();
    return NextResponse.json(dto, { status: 200 });
  };
}

export function createWhaleAggregatesRouteHandler(deps: WhaleAggregateRouteDependencies = {}) {
  const parseQuery = deps.parseQuery ?? parseWhaleHoldingsQuery;
  const getAggregates = deps.getAggregates ?? getCachedWhaleInsiderAggregates;

  return async function GET(
    request: Request,
    context: { params: { managerId: string } }
  ) {
    const searchParams = new URL(request.url).searchParams;
    const parsedQuery = parseQuery({
      managerId: context.params.managerId,
      page: searchParams.get("page"),
      pageSize: searchParams.get("pageSize"),
      action: searchParams.get("action"),
      search: searchParams.get("search")
    });

    if (!parsedQuery.ok) {
      return NextResponse.json(parsedQuery.error, { status: 400 });
    }

    try {
      const dto = await getAggregates(parsedQuery.value);
      return NextResponse.json(dto, { status: 200 });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Unknown manager id:")) {
        return NextResponse.json(
          {
            error: {
              code: "manager_not_found",
              message: error.message
            }
          },
          { status: 404 }
        );
      }

      throw error;
    }
  };
}

export function createWhaleManagerDirectoryRouteHandler(deps: WhaleManagerDirectoryRouteDependencies = {}) {
  const getDirectory = deps.getDirectory ?? getCachedWhaleManagerDirectory;

  return async function GET() {
    const dto = await getDirectory();
    return NextResponse.json(dto, { status: 200 });
  };
}
