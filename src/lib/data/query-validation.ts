import { FILING_ACTIONS, type FilingAction } from "@/lib/domain/enums";
import type { QueryValidationErrorDto, WhaleHoldingsQueryInput, WhaleHoldingsQueryParams } from "@/lib/data/types";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;
const ACTION_FILTERS = ["ALL", ...FILING_ACTIONS] as const;

function toPositiveInt(value: string, fieldName: "page" | "pageSize"):
  | { ok: true; value: number }
  | { ok: false; detail: QueryValidationErrorDto["error"]["details"][number] } {
  if (!/^\d+$/.test(value)) {
    return {
      ok: false,
      detail: {
        field: fieldName,
        reason: "must_be_positive_integer",
        received: value
      }
    };
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return {
      ok: false,
      detail: {
        field: fieldName,
        reason: "must_be_positive_integer",
        received: value
      }
    };
  }

  return { ok: true, value: parsed };
}

export function buildInvalidQueryError(details: QueryValidationErrorDto["error"]["details"]): QueryValidationErrorDto {
  return {
    error: {
      code: "invalid_query_params",
      message: "Invalid whale holdings query parameters.",
      details
    }
  };
}

export function parseWhaleHoldingsQuery(
  input: WhaleHoldingsQueryInput
):
  | { ok: true; value: WhaleHoldingsQueryParams }
  | { ok: false; error: QueryValidationErrorDto } {
  const details: QueryValidationErrorDto["error"]["details"] = [];

  const pageRaw = input.page?.trim();
  const pageSizeRaw = input.pageSize?.trim();
  const actionRaw = input.action?.trim().toUpperCase();
  const searchRaw = input.search?.trim();

  let page = DEFAULT_PAGE;
  let pageSize = DEFAULT_PAGE_SIZE;

  if (pageRaw) {
    const parsedPage = toPositiveInt(pageRaw, "page");
    if (!parsedPage.ok) {
      details.push(parsedPage.detail);
    } else {
      page = parsedPage.value;
    }
  }

  if (pageSizeRaw) {
    const parsedPageSize = toPositiveInt(pageSizeRaw, "pageSize");
    if (!parsedPageSize.ok) {
      details.push(parsedPageSize.detail);
    } else {
      pageSize = parsedPageSize.value;
      if (pageSize > MAX_PAGE_SIZE) {
        details.push({
          field: "pageSize",
          reason: "must_be_between_1_and_50",
          received: pageSizeRaw
        });
      }
    }
  }

  let action: "ALL" | FilingAction = "ALL";
  if (actionRaw) {
    if (!ACTION_FILTERS.includes(actionRaw as (typeof ACTION_FILTERS)[number])) {
      details.push({
        field: "action",
        reason: "unsupported_filter",
        allowedValues: [...ACTION_FILTERS],
        received: actionRaw
      });
    } else {
      action = actionRaw as "ALL" | FilingAction;
    }
  }

  if (details.length > 0) {
    return {
      ok: false,
      error: buildInvalidQueryError(details)
    };
  }

  return {
    ok: true,
    value: {
      managerId: input.managerId,
      page,
      pageSize,
      action,
      search: searchRaw && searchRaw.length > 0 ? searchRaw : undefined
    }
  };
}
