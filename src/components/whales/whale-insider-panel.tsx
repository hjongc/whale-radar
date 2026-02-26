"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Panel, SectionHeader } from "@/components/layout/surface-primitives";
import { ChangeMixChart } from "@/components/whales/change-mix-chart";
import { FilterChips } from "@/components/whales/filter-chips";
import { GapFinderChart } from "@/components/whales/gap-finder-chart";
import {
  actionFilterToLabel,
  actionLabelToEnum,
  type WhaleTableActionFilter,
  WHALE_ACTION_FILTERS
} from "@/components/whales/interaction-state";
import { PositionsTable } from "@/components/whales/positions-table";
import type { WhaleInsiderAggregateDto, WhaleManagerDirectoryItemDto } from "@/lib/data/types";

type WhaleInsiderPanelProps = {
  initialWhaleSlug?: string;
};

type WhaleManagerOption = {
  managerId: string;
  managerName: string;
  institutionName: string;
  representativeManager: string;
  managerSlug: string;
  reportPeriod: string;
  tickers: string[];
  stale: boolean;
};

type WhalePanelState = "idle" | "loading" | "ready" | "error";

const TOP_MANAGER_LIMIT = 10;
const DEFAULT_MANAGER_KEYWORD = "berkshirehathaway";

function slugifyManagerName(managerName: string): string {
  return managerName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeManagerLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findDefaultManager(managers: WhaleManagerOption[]): WhaleManagerOption | undefined {
  return managers.find((manager) => {
    const managerName = normalizeManagerLabel(manager.managerName);
    const institutionName = normalizeManagerLabel(manager.institutionName);
    return managerName.includes(DEFAULT_MANAGER_KEYWORD) || institutionName.includes(DEFAULT_MANAGER_KEYWORD);
  });
}

function resolveManagerFromQuery(
  whaleQuery: string | null | undefined,
  managers: WhaleManagerOption[]
): WhaleManagerOption | undefined {
  if (!whaleQuery) {
    return findDefaultManager(managers) ?? managers[0];
  }

  return (
    managers.find(
      (manager) => manager.managerSlug === whaleQuery || manager.managerId === whaleQuery
    ) ?? managers[0]
  );
}

function toWhaleManagerOption(entry: WhaleManagerDirectoryItemDto): WhaleManagerOption {
  return {
    managerId: entry.managerId,
    managerName: entry.managerName,
    institutionName: entry.institutionName,
    representativeManager: entry.representativeManager,
    managerSlug: slugifyManagerName(entry.managerName),
    reportPeriod: entry.reportPeriod,
    tickers: [],
    stale: entry.stale
  };
}

export function WhaleInsiderPanel({ initialWhaleSlug }: WhaleInsiderPanelProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const positionRowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  const [managerOptions, setManagerOptions] = useState<WhaleManagerOption[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [selectedManagerSlug, setSelectedManagerSlug] = useState("");
  const [state, setState] = useState<WhalePanelState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [insightData, setInsightData] = useState<WhaleInsiderAggregateDto | null>(null);
  const [tableActionFilter, setTableActionFilter] = useState<WhaleTableActionFilter>("ALL");
  const [holdingSearchTerm, setHoldingSearchTerm] = useState("");
  const [debouncedHoldingSearchTerm, setDebouncedHoldingSearchTerm] = useState("");
  const [highlightedTicker, setHighlightedTicker] = useState<string | null>(null);
  const [couplingMessage, setCouplingMessage] = useState<string | null>(null);
  const [tablePage, setTablePage] = useState(1);
  const initialWhaleSlugRef = useRef(initialWhaleSlug);
  const lastNonEmptyManagerOptionsRef = useRef<WhaleManagerOption[]>([]);
  const insightCacheRef = useRef<Map<string, WhaleInsiderAggregateDto>>(new Map());

  useEffect(() => {
    if (managerOptions.length > 0) {
      lastNonEmptyManagerOptionsRef.current = managerOptions;
    }
  }, [managerOptions]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedHoldingSearchTerm(holdingSearchTerm.trim());
    }, 300);

    return () => {
      window.clearTimeout(handle);
    };
  }, [holdingSearchTerm]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    const loadManagers = async () => {
      try {
        const response = await fetch("/api/aggregates/whales/managers", {
          method: "GET",
          cache: "no-store",
          signal: controller.signal
        });

        const payload = (await response.json()) as WhaleManagerDirectoryItemDto[];
        if (!response.ok || !Array.isArray(payload)) {
          throw new Error("Unable to load manager directory.");
        }

        if (!active) {
          return;
        }

        const options = payload.map(toWhaleManagerOption);
        if (options.length === 0) {
          if (lastNonEmptyManagerOptionsRef.current.length > 0) {
            setErrorMessage("운용사 목록이 일시적으로 비어 있어 마지막 정상 목록을 유지합니다.");
            return;
          }

          throw new Error("운용사 목록을 불러오지 못했습니다.");
        }

        setErrorMessage(null);
        setManagerOptions(options);
        const resolved = resolveManagerFromQuery(initialWhaleSlugRef.current, options);
        if (resolved) {
          setSelectedManagerSlug(resolved.managerSlug);
        }
      } catch (error) {
        if (!active || (error instanceof Error && error.name === "AbortError")) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : "Unable to load manager directory.");
        setState("error");
      }
    };

    void loadManagers();

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const selectedManager = useMemo(
    () => managerOptions.find((manager) => manager.managerSlug === selectedManagerSlug),
    [managerOptions, selectedManagerSlug]
  );

  const topManagers = useMemo(() => managerOptions.slice(0, TOP_MANAGER_LIMIT), [managerOptions]);
  const topManagerSlugs = useMemo(() => new Set(topManagers.map((manager) => manager.managerSlug)), [topManagers]);

  const selectedFromSearch = useMemo(() => {
    if (!selectedManager) {
      return undefined;
    }

    return topManagerSlugs.has(selectedManager.managerSlug) ? undefined : selectedManager;
  }, [selectedManager, topManagerSlugs]);

  const filteredManagers = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    const searchablePool = managerOptions.filter((manager) => !topManagerSlugs.has(manager.managerSlug));
    if (keyword.length === 0) {
      return searchablePool;
    }

    return searchablePool.filter((manager) => {
      if (manager.managerName.toLowerCase().includes(keyword)) {
        return true;
      }

      if (manager.institutionName.toLowerCase().includes(keyword)) {
        return true;
      }

      if (manager.representativeManager.toLowerCase().includes(keyword)) {
        return true;
      }

      if (manager.managerSlug.includes(keyword)) {
        return true;
      }

      return manager.tickers.some((ticker) => ticker.toLowerCase().includes(keyword));
    });
  }, [managerOptions, searchTerm, topManagerSlugs]);

  const topManagersMatchSearch = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    if (keyword.length === 0) {
      return false;
    }

    return topManagers.some((manager) => {
      if (manager.managerName.toLowerCase().includes(keyword)) {
        return true;
      }

      if (manager.institutionName.toLowerCase().includes(keyword)) {
        return true;
      }

      if (manager.representativeManager.toLowerCase().includes(keyword)) {
        return true;
      }

      return manager.managerSlug.includes(keyword);
    });
  }, [searchTerm, topManagers]);

  const currentWhaleQuery = searchParams.get("whale");
  const searchParamsSnapshot = searchParams.toString();

  useEffect(() => {
    if (!currentWhaleQuery) {
      return;
    }

    const querySelectedManager = resolveManagerFromQuery(currentWhaleQuery, managerOptions);
    if (!querySelectedManager) {
      return;
    }

    setSelectedManagerSlug((previousSlug) =>
      previousSlug === querySelectedManager.managerSlug ? previousSlug : querySelectedManager.managerSlug
    );
  }, [currentWhaleQuery, managerOptions]);

  useEffect(() => {
    if (!selectedManager) {
      return;
    }

    if (currentWhaleQuery === selectedManager.managerSlug) {
      return;
    }

    const nextParams = new URLSearchParams(searchParamsSnapshot);
    nextParams.set("whale", selectedManager.managerSlug);
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  }, [currentWhaleQuery, pathname, router, searchParamsSnapshot, selectedManager]);

  useEffect(() => {
    if (!selectedManager) {
      return;
    }

    const retryAttempt = refreshTick;
    const cacheKey = [
      selectedManager.managerId,
      tableActionFilter,
      String(tablePage),
      debouncedHoldingSearchTerm,
      String(retryAttempt)
    ].join("|");
    const cached = insightCacheRef.current.get(cacheKey);
    if (cached) {
      setErrorMessage(null);
      setInsightData(cached);
      setState("ready");
      return;
    }

    const controller = new AbortController();
    let active = true;

    const loadInsight = async () => {
      setState("loading");
      setErrorMessage(null);

      try {
        const params = new URLSearchParams({
          page: String(tablePage),
          pageSize: "20",
          action: tableActionFilter,
          retry: String(retryAttempt)
        });
        if (debouncedHoldingSearchTerm.length > 0) {
          params.set("search", debouncedHoldingSearchTerm);
        }

        const response = await fetch(
          `/api/aggregates/whales/${selectedManager.managerId}?${params.toString()}`,
          {
            method: "GET",
            cache: "no-store",
            signal: controller.signal
          }
        );

        const payload = (await response.json()) as unknown;

        if (!response.ok) {
          const errorPayload = payload as { error?: { message?: string } };
          throw new Error(errorPayload.error?.message ?? `Unable to load ${selectedManager.managerName}.`);
        }

        if (!active) {
          return;
        }

        const typedPayload = payload as WhaleInsiderAggregateDto;
        insightCacheRef.current.set(cacheKey, typedPayload);
        setInsightData(typedPayload);
        setState("ready");
      } catch (error) {
        if (!active) {
          return;
        }

        if (error instanceof Error && error.name === "AbortError") {
          return;
        }

        setInsightData(null);
        setState("error");
        setErrorMessage(error instanceof Error ? error.message : "운용사 동향 데이터를 불러오지 못했습니다.");
      }
    };

    void loadInsight();

    return () => {
      active = false;
      controller.abort();
    };
  }, [debouncedHoldingSearchTerm, refreshTick, selectedManager, tableActionFilter, tablePage]);

  useEffect(() => {
    if (!selectedManagerSlug) {
      return;
    }

    setTableActionFilter("ALL");
    setHoldingSearchTerm("");
    setTablePage(1);
    setHighlightedTicker(null);
    setCouplingMessage(null);
  }, [selectedManagerSlug]);

  const hasSearchTerm = searchTerm.trim().length > 0;
  const showNoSearchMatches = hasSearchTerm && filteredManagers.length === 0 && !topManagersMatchSearch;

  const filteredRows = useMemo(() => insightData?.holdingsTable.rows ?? [], [insightData]);

  useEffect(() => {
    if (!highlightedTicker) {
      return;
    }

    if (!filteredRows.some((row) => row.ticker === highlightedTicker)) {
      setHighlightedTicker(null);
      return;
    }

    const targetRow = positionRowRefs.current[highlightedTicker];
    targetRow?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }, [filteredRows, highlightedTicker]);

  const handleGapBarClick = (ticker: string) => {
    setCouplingMessage(null);
    setHighlightedTicker(ticker);
  };

  const handleChangeMixLabelClick = (label: string) => {
    const mappedAction = actionLabelToEnum(label);

    if (!mappedAction) {
      setCouplingMessage(`Unsupported action label "${label}". Filter remains unchanged.`);
      return;
    }

    setCouplingMessage(null);
    setTableActionFilter(mappedAction);
    setTablePage(1);
  };

  const handleChipFilterClick = (filter: WhaleTableActionFilter) => {
    setCouplingMessage(null);
    setTableActionFilter(filter);
    setTablePage(1);
  };

  const totalPages = insightData?.holdingsTable.totalPages ?? 1;
  const currentPage = insightData?.holdingsTable.page ?? tablePage;

  return (
    <>
      <SectionHeader
        subtitle="운용사를 선택하면 URL과 상태가 동기화되고 최신 공시 기준으로 차트와 테이블이 갱신됩니다."
        title="운용사 동향"
      />

      <Panel className="wi-whale-controls">
        <label className="wi-field">
          <span>{`상위 ${TOP_MANAGER_LIMIT}개 운용사 선택`}</span>
          <select
            aria-label="운용사 선택"
            className="whale-select"
            disabled={topManagers.length === 0}
            onChange={(event) => setSelectedManagerSlug(event.currentTarget.value)}
            value={selectedManagerSlug}
          >
            {topManagers.length === 0 ? (
              <option value="">선택 가능한 상위 운용사가 없습니다</option>
            ) : (
              topManagers.map((manager) => (
                <option key={manager.managerSlug} value={manager.managerSlug}>
                  {`${manager.institutionName} (${manager.representativeManager})`}
                </option>
              ))
            )}
            {selectedFromSearch ? (
              <option value={selectedFromSearch.managerSlug}>
                {`${selectedFromSearch.institutionName} (${selectedFromSearch.representativeManager}) (검색 결과)`}
              </option>
            ) : null}
          </select>
        </label>

        <label className="wi-field wi-field--search">
          <span>기관명 또는 대표 매니저 검색</span>
          <input
            aria-label="기관명 또는 대표 매니저 검색"
            className="whale-search-input"
            onChange={(event) => setSearchTerm(event.currentTarget.value)}
            placeholder="기관명 또는 대표 매니저명을 입력하세요"
            type="search"
            value={searchTerm}
          />
        </label>
      </Panel>

      {searchTerm.trim().length > 0 && filteredManagers.length > 0 ? (
        <Panel className="wi-manager-search-results" data-testid="whale-search-results">
          {filteredManagers.map((manager) => (
            <button
              className="wi-manager-result"
              key={manager.managerSlug}
              onClick={() => setSelectedManagerSlug(manager.managerSlug)}
              type="button"
            >
              <strong>{manager.institutionName}</strong>
              <span>{`대표 매니저: ${manager.representativeManager}`}</span>
            </button>
          ))}
        </Panel>
      ) : null}

      {showNoSearchMatches ? (
        <p className="wi-search-empty" data-testid="whale-search-no-results">
          {`${searchTerm}와 일치하는 운용사가 없습니다.`}
        </p>
      ) : hasSearchTerm && filteredManagers.length === 0 && topManagersMatchSearch ? (
        <p className="wi-search-meta">{`상위 ${TOP_MANAGER_LIMIT}개 운용사는 검색 결과에서 제외되며, 위 셀렉터에서 바로 선택할 수 있습니다.`}</p>
      ) : (
        <p className="wi-search-meta">
          {`상위 ${TOP_MANAGER_LIMIT}개는 셀렉터에 고정되어 있습니다. 검색으로 추가 운용사 ${managerOptions.length - topManagers.length}개를 찾을 수 있습니다.`}
        </p>
      )}

      <Panel className="wi-insight-banner" data-state={state}>
        <strong>{selectedManager?.managerName ?? "운용사"} 보유 동향</strong>
        <p>
          {state === "loading"
            ? "운용사 집계와 보유 종목 데이터를 새로고침하는 중입니다..."
            : state === "error"
              ? "데이터 로드에 실패했습니다. 다시 시도해 활성 운용사 뷰를 복구하세요."
              : `${insightData?.manager.reportPeriod ?? selectedManager?.reportPeriod ?? "기간 미상"} 기준 공시 데이터가 차트와 테이블에 반영되었습니다.`}
        </p>
      </Panel>

      <Panel className="wi-chart-panel wi-change-panel">
        <SectionHeader
          compact
          subtitle="행동 유형 비중을 빠르게 선택해 테이블 필터를 즉시 전환합니다."
          title="변동 유형 분포"
        />
        {state === "loading" ? (
          <div aria-busy="true" className="wi-chart-loading panel-skeleton" data-testid="loading-placeholder">
            <span className="wi-skeleton-line" />
            <span className="wi-skeleton-line" />
            <span className="wi-skeleton-line" />
          </div>
        ) : state === "error" ? (
          <p className="wi-chart-placeholder">오류 상태에서는 변동 유형 차트를 표시할 수 없습니다.</p>
        ) : (
          <ChangeMixChart
            actionMix={insightData?.actionMix ?? []}
            activeAction={tableActionFilter}
            onSelectLabel={handleChangeMixLabelClick}
          />
        )}
      </Panel>

      <Panel className={state === "error" ? "wi-whale-feedback" : undefined}>
        <SectionHeader
          compact
          subtitle="갭 파인더 및 분포 차트 클릭이 테이블 하이라이트와 필터에 연동됩니다."
          title="포지션 상세"
        />

        {state === "loading" ? (
          <div aria-busy="true" className="wi-chart-loading panel-skeleton" data-testid="loading-placeholder">
            <span className="wi-skeleton-line" />
            <span className="wi-skeleton-line" />
            <span className="wi-skeleton-line" />
          </div>
        ) : state === "error" ? (
          <div className="error-panel">
            <p className="wi-error-copy">
              {errorMessage ?? "선택한 운용사 데이터를 불러오지 못했습니다."} 다시 시도하면 최신 스냅샷을 다시 요청합니다.
            </p>
            <button className="wi-retry-button" onClick={() => setRefreshTick((value) => value + 1)} type="button">
              운용사 데이터 다시 불러오기
            </button>
          </div>
        ) : (
          <>
            <FilterChips
              activeFilter={tableActionFilter}
              filters={WHALE_ACTION_FILTERS}
              onSelectFilter={handleChipFilterClick}
            />

            <label className="wi-field wi-field--search wi-position-search">
              <span>포지션 검색</span>
              <input
                aria-label="포지션 검색"
                className="whale-search-input"
                data-testid="positions-search-input"
                onChange={(event) => {
                  setHoldingSearchTerm(event.currentTarget.value);
                  setTablePage(1);
                  setHighlightedTicker(null);
                }}
                placeholder="티커 또는 종목명을 입력하세요"
                type="search"
                value={holdingSearchTerm}
              />
            </label>

            <p className="wi-coupling-status" data-testid="active-action-filter">
              현재 행동 필터: <strong>{actionFilterToLabel(tableActionFilter)}</strong>
            </p>

            <p className="wi-coupling-status wi-coupling-note">
              변화 유형: NEW(신규), ADD(비중확대), REDUCE(비중축소), KEEP(유지).
            </p>

            <p className="wi-coupling-status wi-coupling-note">
              Shares는 포트폴리오 비중이 아니라 공시 원문에 기재된 절대 주식 수량입니다.
            </p>

            {couplingMessage ? (
              <p className="wi-coupling-warning" data-testid="action-label-warning">
                {couplingMessage}
              </p>
            ) : null}

            <PositionsTable
              highlightedTicker={highlightedTicker}
              onRegisterRowRef={(ticker, node) => {
                positionRowRefs.current[ticker] = node;
              }}
              rows={filteredRows}
            />

            {totalPages > 1 ? (
              <div className="wi-pagination" data-testid="positions-pagination">
                <button
                  className="wi-page-button"
                  disabled={currentPage <= 1}
                  onClick={() => setTablePage((page) => Math.max(1, page - 1))}
                  type="button"
                >
                  이전
                </button>
                <p>{`${currentPage} / ${totalPages} 페이지 · 페이지당 상위 20개 보유 종목`}</p>
                <button
                  className="wi-page-button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setTablePage((page) => Math.min(totalPages, page + 1))}
                  type="button"
                >
                  다음
                </button>
              </div>
            ) : null}

            {filteredRows.length === 0 ? (
              <p className="wi-chart-placeholder">현재 행동 필터와 일치하는 행이 없습니다.</p>
            ) : null}
          </>
        )}
      </Panel>

      <Panel className="wi-chart-panel wi-gap-panel">
        <SectionHeader
          compact
          subtitle="음수/양수 갭을 좌우로 분리해 각각 상위 20개를 정렬해 보여줍니다."
          title="갭 파인더"
        />
        {state === "loading" ? (
          <div aria-busy="true" className="wi-chart-loading panel-skeleton" data-testid="loading-placeholder">
            <span className="wi-skeleton-line" />
            <span className="wi-skeleton-line" />
            <span className="wi-skeleton-line" />
          </div>
        ) : state === "error" ? (
          <p className="wi-chart-placeholder">오류 상태에서는 갭 차트를 표시할 수 없습니다.</p>
        ) : (
          <GapFinderChart
            activeTicker={highlightedTicker}
            onSelectTicker={handleGapBarClick}
            rankings={insightData?.gapRanking ?? []}
          />
        )}
      </Panel>
    </>
  );
}
