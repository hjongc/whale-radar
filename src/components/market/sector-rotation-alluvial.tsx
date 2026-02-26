import { sankey, sankeyLeft, sankeyLinkHorizontal } from "d3-sankey";

type RotationFlow = {
  fromSector: string;
  toSector: string;
  weightPct: number;
};

type SectorRotationAlluvialProps = {
  flows: RotationFlow[];
};

type AlluvialNode = {
  id: string;
  label: string;
  side: "left" | "right";
  color: string;
};

type AlluvialLink = {
  source: string;
  target: string;
  value: number;
  color: string;
  fromLabel: string;
  toLabel: string;
};

const FLOW_COLORS = ["#38bdf8", "#818cf8", "#10b981", "#f43f5e", "#f59e0b", "#22d3ee"];

function buildAlluvial(flows: RotationFlow[]) {
  const activeFlows = flows.filter((flow) => flow.weightPct > 0);
  const leftSectors = [...new Set(activeFlows.map((flow) => flow.fromSector))];
  const rightSectors = [...new Set(activeFlows.map((flow) => flow.toSector))];

  const colorBySource = new Map(leftSectors.map((sector, index) => [sector, FLOW_COLORS[index % FLOW_COLORS.length]]));

  const nodes: AlluvialNode[] = [
    ...leftSectors.map((sector) => ({
      id: `left:${sector}`,
      label: sector,
      side: "left" as const,
      color: colorBySource.get(sector) ?? FLOW_COLORS[0]
    })),
    ...rightSectors.map((sector) => ({
      id: `right:${sector}`,
      label: sector,
      side: "right" as const,
      color: "#3b4f71"
    }))
  ];

  const links: AlluvialLink[] = activeFlows.map((flow) => ({
    source: `left:${flow.fromSector}`,
    target: `right:${flow.toSector}`,
    value: flow.weightPct,
    color: colorBySource.get(flow.fromSector) ?? FLOW_COLORS[0],
    fromLabel: flow.fromSector,
    toLabel: flow.toSector
  }));

  const layout = sankey<AlluvialNode, AlluvialLink>()
    .nodeId((node) => node.id)
    .nodeAlign(sankeyLeft)
    .nodeWidth(16)
    .nodePadding(20)
    .extent([
      [30, 20],
      [870, 330]
    ]);

  return layout({
    nodes: nodes.map((node) => ({ ...node })),
    links: links.map((link) => ({ ...link }))
  });
}

export function SectorRotationAlluvial({ flows }: SectorRotationAlluvialProps) {
  const graph = buildAlluvial(flows);
  const pathFactory = sankeyLinkHorizontal<AlluvialNode, AlluvialLink>();
  const linkThicknessScale = 0.56;

  const leftLabels = [...graph.nodes]
    .filter((node) => node.side === "left")
    .sort((left, right) => (left.y0 ?? 0) - (right.y0 ?? 0));

  const rightLabels = [...graph.nodes]
    .filter((node) => node.side === "right")
    .sort((left, right) => (left.y0 ?? 0) - (right.y0 ?? 0));

  return (
    <div className="wi-sankey-canvas" data-testid="sector-rotation-alluvial">
      <div className="wi-sankey-header-row" aria-hidden="true">
        <span>PREV QUARTER</span>
        <span>CURRENT QUARTER</span>
      </div>
      <div className="wi-alluvial-layout">
        <aside className="wi-alluvial-label-rail wi-alluvial-label-rail--left">
          {leftLabels.map((node) => (
            <div className="wi-alluvial-label" key={node.id}>
              <i style={{ backgroundColor: node.color }} />
              <span>{node.label}</span>
            </div>
          ))}
        </aside>

        <svg aria-label="Sector rotation alluvial diagram" className="wi-sankey-svg wi-sankey-svg--alluvial" role="img" viewBox="0 0 900 360">
          {graph.links.map((link, index) => {
            const path = pathFactory(link);
            if (!path) {
              return null;
            }

            return (
              <path
                className="wi-sankey-link"
                d={path}
                fill="none"
                key={`${link.fromLabel}-${link.toLabel}-${index}`}
                opacity="0.58"
                stroke={link.color}
                strokeLinecap="round"
                strokeWidth={Math.max((link.width ?? 0) * linkThicknessScale, 1)}
              >
                <title>{`${link.fromLabel} -> ${link.toLabel} (${link.value.toFixed(2)}%)`}</title>
              </path>
            );
          })}

          {graph.nodes.map((node) => {
            const x0 = node.x0 ?? 0;
            const y0 = node.y0 ?? 0;
            const x1 = node.x1 ?? 0;
            const y1 = node.y1 ?? 0;

            return (
              <g key={node.id}>
                <rect
                  className="wi-sankey-node"
                  fill="#1f2f4a"
                  height={Math.max(y1 - y0, 0)}
                  rx={8}
                  stroke={node.side === "left" ? node.color : "#3b4f71"}
                  strokeWidth={1.2}
                  width={Math.max(x1 - x0, 0)}
                  x={x0}
                  y={y0}
                />
              </g>
            );
          })}
        </svg>

        <aside className="wi-alluvial-label-rail wi-alluvial-label-rail--right">
          {rightLabels.map((node) => (
            <div className="wi-alluvial-label" key={node.id}>
              <span>{node.label}</span>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
