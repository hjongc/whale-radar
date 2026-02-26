"use client";

import { RouteErrorPanel } from "@/components/common/route-fallbacks";

type MarketErrorBoundaryProps = {
  error: Error;
  reset: () => void;
};

export default function MarketErrorBoundary({ error, reset }: MarketErrorBoundaryProps) {
  return (
    <RouteErrorPanel
      copy={`${error.message}. 다시 시도하면 전체 앱을 새로고침하지 않고 마켓 집계를 다시 요청합니다.`}
      onRetry={reset}
      retryLabel="마켓 데이터 다시 불러오기"
      title="마켓 허브를 불러오지 못했습니다"
    />
  );
}
