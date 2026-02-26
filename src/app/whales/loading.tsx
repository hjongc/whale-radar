import { RouteLoadingPanel } from "@/components/common/route-fallbacks";

export default function WhalesLoading() {
  return (
    <RouteLoadingPanel
      copy="운용사 동향 화면을 위해 운용사 목록, 포지션 테이블, 차트 연동 상태를 준비하고 있습니다."
      title="운용사 동향 불러오는 중"
    />
  );
}
