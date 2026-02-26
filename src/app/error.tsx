"use client";

import { RouteErrorPanel } from "@/components/common/route-fallbacks";

type AppErrorBoundaryProps = {
  error: Error;
  reset: () => void;
};

export default function AppErrorBoundary({ error, reset }: AppErrorBoundaryProps) {
  return (
    <RouteErrorPanel
      copy={`${error.message}. Retry now. If it continues, run a targeted ops refresh and retry.`}
      onRetry={reset}
      retryLabel="Retry dashboard load"
      title="Dashboard data is temporarily unavailable"
    />
  );
}
