"use client";

import { Panel } from "@/components/layout/surface-primitives";

type RouteLoadingPanelProps = {
  title: string;
  copy: string;
};

type RouteErrorPanelProps = {
  title: string;
  copy: string;
  retryLabel?: string;
  onRetry: () => void;
};

export function RouteLoadingPanel({ title, copy }: RouteLoadingPanelProps) {
  return (
    <main className="wi-shell">
      <Panel className="panel-skeleton" data-testid="route-loading-panel">
        <p className="wi-kicker">로딩 중</p>
        <h2 className="wi-section-title">{title}</h2>
        <p className="wi-chart-placeholder">{copy}</p>
        <div aria-busy="true" className="wi-chart-loading panel-skeleton" data-testid="loading-placeholder">
          <span className="wi-skeleton-line" />
          <span className="wi-skeleton-line" />
          <span className="wi-skeleton-line" />
        </div>
      </Panel>
    </main>
  );
}

export function RouteErrorPanel({ title, copy, retryLabel = "다시 시도", onRetry }: RouteErrorPanelProps) {
  return (
    <main className="wi-shell">
      <Panel className="error-panel">
        <p className="wi-kicker">데이터 오류</p>
        <h2 className="wi-section-title">{title}</h2>
        <p className="wi-error-copy">{copy}</p>
        <button className="wi-retry-button" onClick={onRetry} type="button">
          {retryLabel}
        </button>
      </Panel>
    </main>
  );
}
