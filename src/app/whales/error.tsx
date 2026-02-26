"use client";

import { RouteErrorPanel } from "@/components/common/route-fallbacks";

type WhalesErrorBoundaryProps = {
  error: Error;
  reset: () => void;
};

export default function WhalesErrorBoundary({ error, reset }: WhalesErrorBoundaryProps) {
  return (
    <RouteErrorPanel
      copy={`${error.message}. 다시 시도하면 URL에 선택된 운용사 상태를 유지한 채 상세 데이터를 복구합니다.`}
      onRetry={reset}
      retryLabel="운용사 데이터 다시 불러오기"
      title="운용사 동향을 불러오지 못했습니다"
    />
  );
}
