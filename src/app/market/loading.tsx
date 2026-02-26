import { RouteLoadingPanel } from "@/components/common/route-fallbacks";

export default function MarketLoading() {
  return (
    <RouteLoadingPanel
      copy="현재 마켓 스냅샷의 KPI 카드와 차트 레이아웃을 준비하고 있습니다."
      title="마켓 허브 불러오는 중"
    />
  );
}
