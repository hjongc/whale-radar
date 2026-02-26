import type { FilingAction } from "@/lib/domain/enums";

interface WhaleHoldingRecord {
  accession: string;
  ticker: string;
  issuerName: string;
  type: FilingAction;
  valueUsdThousands?: number;
  shares?: number;
  weightPct: number;
  cost: number | null;
  price: number;
  gapPct: number | null;
  gapKnown?: boolean;
  gap_reason?: string;
  price_timestamp: string;
  source: "yahoo";
  calc_version: string;
  stale_badge: "fresh" | "stale";
  stale_reason?: string;
}

export interface WhaleManagerAggregateSource {
  managerId: string;
  managerName: string;
  institutionName: string;
  representativeManager: string;
  reportPeriod: string;
  holdings: WhaleHoldingRecord[];
}

export interface MarketAggregateSource {
  updatedQuarter: string;
  trackedInstitutions: number;
  featuredInstitutions: Array<{ institutionName: string; representativeManager: string }>;
  mostOwned: Array<{ ticker: string; institutionCount: number }>;
  sectorRotation: Array<{ fromSector: string; toSector: string; weightPct: number }>;
  sectorConcentration: Array<{ sector: string; weightPct: number }>;
  cashTrend: Array<{ quarter: string; cashWeightPct: number }>;
}

export interface AggregateSourceBundle {
  market: MarketAggregateSource;
  whales: WhaleManagerAggregateSource[];
}

interface ManagerDirectoryRow {
  managerId: string;
  managerName: string;
  institutionName: string;
  representativeManager: string;
}

const reportPeriod = "2026-Q1";
const priceTimestamp = "2026-02-17T00:00:00.000Z";

const tickerUniverse = [
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "GOOGL",
  "META",
  "BRK.B",
  "JPM",
  "XOM",
  "LLY",
  "V",
  "AVGO",
  "TSLA",
  "UNH",
  "MA",
  "COST",
  "HD",
  "PG",
  "NFLX",
  "BAC"
] as const;

const issuerByTicker: Record<string, string> = {
  AAPL: "Apple Inc.",
  MSFT: "Microsoft Corp.",
  NVDA: "NVIDIA Corp.",
  AMZN: "Amazon.com Inc.",
  GOOGL: "Alphabet Inc.",
  META: "Meta Platforms Inc.",
  "BRK.B": "Berkshire Hathaway Inc.",
  JPM: "JPMorgan Chase & Co.",
  XOM: "Exxon Mobil Corp.",
  LLY: "Eli Lilly and Co.",
  V: "Visa Inc.",
  AVGO: "Broadcom Inc.",
  TSLA: "Tesla Inc.",
  UNH: "UnitedHealth Group Inc.",
  MA: "Mastercard Inc.",
  COST: "Costco Wholesale Corp.",
  HD: "Home Depot Inc.",
  PG: "Procter & Gamble Co.",
  NFLX: "Netflix Inc.",
  BAC: "Bank of America Corp."
};

const topFiftyManagers: ManagerDirectoryRow[] = [
  { managerId: "berkshire", managerName: "Berkshire Hathaway", institutionName: "Berkshire Hathaway Inc.", representativeManager: "Warren Buffett" },
  { managerId: "duquesne", managerName: "Duquesne Family Office", institutionName: "Duquesne Family Office LLC", representativeManager: "Stanley Druckenmiller" },
  { managerId: "pershing-square", managerName: "Pershing Square Capital", institutionName: "Pershing Square Capital Management, L.P.", representativeManager: "Bill Ackman" },
  { managerId: "point72", managerName: "Point72 Asset Management", institutionName: "Point72 Asset Management, L.P.", representativeManager: "Steve Cohen" },
  { managerId: "soros-fund", managerName: "Soros Fund Management", institutionName: "Soros Fund Management LLC", representativeManager: "George Soros" },
  { managerId: "scion", managerName: "Scion Asset Management", institutionName: "Scion Asset Management, LLC", representativeManager: "Michael Burry" },
  { managerId: "bridgewater", managerName: "Bridgewater Associates", institutionName: "Bridgewater Associates, LP", representativeManager: "Ray Dalio" },
  { managerId: "renaissance", managerName: "Renaissance Technologies", institutionName: "Renaissance Technologies LLC", representativeManager: "Jim Simons" },
  { managerId: "citadel", managerName: "Citadel Advisors", institutionName: "Citadel Advisors LLC", representativeManager: "Ken Griffin" },
  { managerId: "appaloosa", managerName: "Appaloosa Management", institutionName: "Appaloosa LP", representativeManager: "David Tepper" },
  { managerId: "third-point", managerName: "Third Point", institutionName: "Third Point LLC", representativeManager: "Daniel Loeb" },
  { managerId: "greenlight", managerName: "Greenlight Capital", institutionName: "Greenlight Capital Inc.", representativeManager: "David Einhorn" },
  { managerId: "gotham", managerName: "Gotham Asset Management", institutionName: "Gotham Asset Management, LLC", representativeManager: "Joel Greenblatt" },
  { managerId: "baupost", managerName: "Baupost Group", institutionName: "The Baupost Group, L.L.C.", representativeManager: "Seth Klarman" },
  { managerId: "icahn", managerName: "Icahn Capital", institutionName: "Icahn Capital LP", representativeManager: "Carl Icahn" },
  { managerId: "tiger-global", managerName: "Tiger Global", institutionName: "Tiger Global Management, LLC", representativeManager: "Chase Coleman" },
  { managerId: "coatue", managerName: "Coatue Management", institutionName: "Coatue Management LLC", representativeManager: "Philippe Laffont" },
  { managerId: "lone-pine", managerName: "Lone Pine Capital", institutionName: "Lone Pine Capital LLC", representativeManager: "Stephen Mandel" },
  { managerId: "viking", managerName: "Viking Global", institutionName: "Viking Global Investors LP", representativeManager: "Andreas Halvorsen" },
  { managerId: "de-shaw", managerName: "D. E. Shaw", institutionName: "D. E. Shaw & Co., L.P.", representativeManager: "David E. Shaw" },
  { managerId: "two-sigma", managerName: "Two Sigma", institutionName: "Two Sigma Advisers, LP", representativeManager: "John Overdeck" },
  { managerId: "millennium", managerName: "Millennium", institutionName: "Millennium Management LLC", representativeManager: "Israel Englander" },
  { managerId: "elliott", managerName: "Elliott Investment", institutionName: "Elliott Investment Management L.P.", representativeManager: "Paul Singer" },
  { managerId: "farallon", managerName: "Farallon Capital", institutionName: "Farallon Capital Management, L.L.C.", representativeManager: "Tom Steyer" },
  { managerId: "tci", managerName: "TCI Fund Management", institutionName: "TCI Fund Management Ltd.", representativeManager: "Chris Hohn" },
  { managerId: "valueact", managerName: "ValueAct Capital", institutionName: "ValueAct Holdings, L.P.", representativeManager: "Mason Morfit" },
  { managerId: "oakmark", managerName: "Harris Associates", institutionName: "Harris Associates L.P.", representativeManager: "Bill Nygren" },
  { managerId: "pabrai", managerName: "Pabrai Investments", institutionName: "Pabrai Investment Funds", representativeManager: "Mohnish Pabrai" },
  { managerId: "gates", managerName: "Cascade Investment", institutionName: "Cascade Investment, L.L.C.", representativeManager: "Bill Gates" },
  { managerId: "southeastern", managerName: "Southeastern Asset", institutionName: "Southeastern Asset Management, Inc.", representativeManager: "Mason Hawkins" },
  { managerId: "holocene", managerName: "Holocene Advisors", institutionName: "Holocene Advisors, LP", representativeManager: "Brandon Haley" },
  { managerId: "whale-rock", managerName: "Whale Rock Capital", institutionName: "Whale Rock Capital Management LLC", representativeManager: "Alex Sacerdote" },
  { managerId: "pershing-fox", managerName: "Tiger Pacific", institutionName: "Tiger Pacific Capital LP", representativeManager: "Scott Shleifer" },
  { managerId: "blackrock", managerName: "BlackRock", institutionName: "BlackRock Fund Advisors", representativeManager: "Larry Fink" },
  { managerId: "vanguard", managerName: "Vanguard", institutionName: "Vanguard Group Inc.", representativeManager: "Salim Ramji" },
  { managerId: "state-street", managerName: "State Street", institutionName: "State Street Global Advisors", representativeManager: "Yie-Hsin Hung" },
  { managerId: "fidelity", managerName: "Fidelity", institutionName: "FMR LLC", representativeManager: "Abigail Johnson" },
  { managerId: "capital-group", managerName: "Capital Group", institutionName: "Capital World Investors", representativeManager: "Mike Gitlin" },
  { managerId: "invesco", managerName: "Invesco", institutionName: "Invesco Ltd.", representativeManager: "Andrew Schlossberg" },
  { managerId: "trowe", managerName: "T. Rowe Price", institutionName: "T. Rowe Price Associates, Inc.", representativeManager: "Rob Sharps" },
  { managerId: "wellington", managerName: "Wellington Management", institutionName: "Wellington Management Group LLP", representativeManager: "Jean Hynes" },
  { managerId: "jpmam", managerName: "JPMorgan Asset Mgmt", institutionName: "JPMorgan Asset Management", representativeManager: "George Gatch" },
  { managerId: "goldman-am", managerName: "Goldman Sachs AM", institutionName: "Goldman Sachs Asset Management, L.P.", representativeManager: "Julian Salisbury" },
  { managerId: "morgan-stanley-am", managerName: "Morgan Stanley IM", institutionName: "Morgan Stanley Investment Management", representativeManager: "Dan Simkowitz" },
  { managerId: "bankofamerica-am", managerName: "BofA Global Research", institutionName: "Bank of America Corp. Asset Management", representativeManager: "Alastair Borthwick" },
  { managerId: "ubs-am", managerName: "UBS Asset Management", institutionName: "UBS Asset Management Americas Inc.", representativeManager: "Ulrich Korner" },
  { managerId: "franklin", managerName: "Franklin Templeton", institutionName: "Franklin Resources Inc.", representativeManager: "Jenny Johnson" },
  { managerId: "dimensional", managerName: "Dimensional Fund", institutionName: "Dimensional Fund Advisors LP", representativeManager: "Gerard O'Reilly" },
  { managerId: "pzena", managerName: "Pzena Investment", institutionName: "Pzena Investment Management, LLC", representativeManager: "Richard Pzena" },
  { managerId: "baron", managerName: "Baron Capital", institutionName: "Baron Capital Management, Inc.", representativeManager: "Ron Baron" }
];

function normalizeWeight(weight: number): number {
  return Number(weight.toFixed(2));
}

function pickTickers(seedIndex: number): string[] {
  return [
    tickerUniverse[seedIndex % tickerUniverse.length],
    tickerUniverse[(seedIndex + 7) % tickerUniverse.length],
    tickerUniverse[(seedIndex + 13) % tickerUniverse.length]
  ];
}

function buildSyntheticHoldings(managerId: string, seedIndex: number): WhaleHoldingRecord[] {
  const tickers = pickTickers(seedIndex);
  const actions: FilingAction[] = ["ADD", "KEEP", "NEW", "REDUCE"];
  const baseWeight = 56 - (seedIndex % 9);
  const secondWeight = 28 + (seedIndex % 5);
  const thirdWeight = 100 - baseWeight - secondWeight;
  const weights = [baseWeight, secondWeight, Math.max(8, thirdWeight)];

  return tickers.map((ticker, index) => {
    const cost = 92 + seedIndex * 1.8 + index * 14;
    const priceDelta = ((seedIndex + index) % 7) - 3;
    const price = cost * (1 + priceDelta * 0.018);
    const gapPct = ((price - cost) / cost) * 100;
    const shares = 1_000_000 + seedIndex * 25_000 + index * 15_000;
    const valueUsdThousands = (price * shares) / 1000;

    return {
      accession: `${managerId}-2026q1`,
      ticker,
      issuerName: issuerByTicker[ticker],
      type: actions[(seedIndex + index) % actions.length],
      valueUsdThousands: Number(valueUsdThousands.toFixed(2)),
      shares: Number(shares.toFixed(4)),
      weightPct: normalizeWeight(weights[index] ?? 8),
      cost: Number(cost.toFixed(4)),
      price: Number(price.toFixed(4)),
      gapPct: Number(gapPct.toFixed(2)),
      price_timestamp: priceTimestamp,
      source: "yahoo",
      calc_version: "seed-top50-v1",
      stale_badge: "fresh"
    };
  });
}

const detailedHoldingsByManager: Record<string, WhaleHoldingRecord[]> = {
  berkshire: [
    {
      accession: "0001067983-24-000101",
      ticker: "AAPL",
      issuerName: "Apple Inc.",
      type: "ADD",
      weightPct: 42.5,
      cost: 178.2,
      price: 185.4,
      gapPct: 4.04,
      price_timestamp: "2024-03-29T00:00:00.000Z",
      source: "yahoo",
      calc_version: "vwap-quarter-v1",
      stale_badge: "fresh"
    },
    {
      accession: "0001067983-24-000101",
      ticker: "AMZN",
      issuerName: "Amazon.com, Inc.",
      type: "NEW",
      weightPct: 5.2,
      cost: 185,
      price: 172.3,
      gapPct: -6.86,
      price_timestamp: "2024-03-29T00:00:00.000Z",
      source: "yahoo",
      calc_version: "vwap-quarter-v1",
      stale_badge: "fresh"
    },
    {
      accession: "0001067983-24-000101",
      ticker: "GOOGL",
      issuerName: "Alphabet Inc.",
      type: "ADD",
      weightPct: 2.5,
      cost: 145,
      price: 152.4,
      gapPct: 5.1,
      price_timestamp: "2024-03-29T00:00:00.000Z",
      source: "yahoo",
      calc_version: "vwap-quarter-v1",
      stale_badge: "fresh"
    },
    {
      accession: "0001067983-24-000101",
      ticker: "PYPL",
      issuerName: "PayPal Holdings, Inc.",
      type: "NEW",
      weightPct: 1.2,
      cost: 85,
      price: 64.2,
      gapPct: -24.47,
      price_timestamp: "2024-03-26T00:00:00.000Z",
      source: "yahoo",
      calc_version: "vwap-quarter-v1",
      stale_badge: "stale",
      stale_reason: "latest_close_older_than_3_days"
    }
  ],
  scion: [
    {
      accession: "0001567619-24-000044",
      ticker: "GOOG",
      issuerName: "Alphabet Inc.",
      type: "NEW",
      weightPct: 21.4,
      cost: 149,
      price: 143.2,
      gapPct: -3.89,
      price_timestamp: "2024-03-29T00:00:00.000Z",
      source: "yahoo",
      calc_version: "vwap-quarter-v1",
      stale_badge: "fresh"
    },
    {
      accession: "0001567619-24-000044",
      ticker: "BABA",
      issuerName: "Alibaba Group Holding Limited",
      type: "ADD",
      weightPct: 13.2,
      cost: 81,
      price: 75.4,
      gapPct: -6.91,
      price_timestamp: "2024-03-29T00:00:00.000Z",
      source: "yahoo",
      calc_version: "vwap-quarter-v1",
      stale_badge: "fresh"
    }
  ]
};

const whaleManagers: WhaleManagerAggregateSource[] = topFiftyManagers.map((row, index) => ({
  managerId: row.managerId,
  managerName: row.managerName,
  institutionName: row.institutionName,
  representativeManager: row.representativeManager,
  reportPeriod,
  holdings: detailedHoldingsByManager[row.managerId] ?? buildSyntheticHoldings(row.managerId, index)
}));

export const seedAggregateSource: AggregateSourceBundle = {
  market: {
    updatedQuarter: reportPeriod,
    trackedInstitutions: whaleManagers.length,
    featuredInstitutions: whaleManagers.slice(0, 5).map((manager) => ({
      institutionName: manager.institutionName,
      representativeManager: manager.representativeManager
    })),
    mostOwned: [
      { ticker: "AAPL", institutionCount: 43 },
      { ticker: "MSFT", institutionCount: 41 },
      { ticker: "NVDA", institutionCount: 39 },
      { ticker: "AMZN", institutionCount: 35 },
      { ticker: "GOOGL", institutionCount: 33 }
    ],
    sectorRotation: [
      { fromSector: "IT / Tech", toSector: "Health Care", weightPct: 6.4 },
      { fromSector: "IT / Tech", toSector: "Energy", weightPct: 4.1 },
      { fromSector: "Finance", toSector: "IT / Tech", weightPct: 3.8 },
      { fromSector: "Industrials", toSector: "Big Tech", weightPct: 2.9 }
    ],
    sectorConcentration: [
      { sector: "Information Technology", weightPct: 23.4 },
      { sector: "Financials", weightPct: 17.8 },
      { sector: "Health Care", weightPct: 15.2 },
      { sector: "Consumer Discretionary", weightPct: 12.7 },
      { sector: "Communication Services", weightPct: 11.3 },
      { sector: "Industrials", weightPct: 8.5 }
    ],
    cashTrend: [
      { quarter: "25Q1", cashWeightPct: 10.4 },
      { quarter: "25Q2", cashWeightPct: 11.8 },
      { quarter: "25Q3", cashWeightPct: 13.1 },
      { quarter: "25Q4", cashWeightPct: 14.2 },
      { quarter: "26Q1", cashWeightPct: 15.6 }
    ]
  },
  whales: whaleManagers
};
