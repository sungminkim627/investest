import { HoldingInput } from "@/types";

export type PortfolioTemplateTheme =
  | "The Classics"
  | "High Growth & Innovation"
  | "Income & Dividends"
  | "Defensive & Conservative"
  | "Thematic & Specialty";

export interface PortfolioTemplate {
  id: string;
  name: string;
  theme: PortfolioTemplateTheme;
  risk: 1 | 2 | 3 | 4 | 5;
  summary: string;
  holdings: HoldingInput[];
}

export const PORTFOLIO_TEMPLATES: PortfolioTemplate[] = [
  {
    id: "total-world-boglehead",
    name: "Total World (Boglehead)",
    theme: "The Classics",
    risk: 3,
    summary: "Own every major company on Earth.",
    holdings: [
      { symbol: "VTI", weight: 60 },
      { symbol: "VXUS", weight: 30 },
      { symbol: "BND", weight: 10 }
    ]
  },
  {
    id: "sp500-core",
    name: "S&P 500 Core",
    theme: "The Classics",
    risk: 4,
    summary: "The 500 biggest US corporate leaders.",
    holdings: [{ symbol: "VOO", weight: 100 }]
  },
  {
    id: "classic-60-40",
    name: "Classic 60/40",
    theme: "The Classics",
    risk: 2,
    summary: "The \"Smooth Ride\" for long-term safety.",
    holdings: [
      { symbol: "VTI", weight: 60 },
      { symbol: "BND", weight: 40 }
    ]
  },
  {
    id: "us-total-market",
    name: "US Total Market",
    theme: "The Classics",
    risk: 4,
    summary: "Every public company in the USA.",
    holdings: [{ symbol: "VTI", weight: 100 }]
  },
  {
    id: "tech-titan",
    name: "The Tech Titan",
    theme: "High Growth & Innovation",
    risk: 5,
    summary: "A high-octane bet on the Nasdaq 100.",
    holdings: [{ symbol: "QQQ", weight: 100 }]
  },
  {
    id: "ai-infrastructure",
    name: "AI Infrastructure",
    theme: "High Growth & Innovation",
    risk: 5,
    summary: "Chips plus the power needed to run them.",
    holdings: [
      { symbol: "SMH", weight: 60 },
      { symbol: "XLU", weight: 40 }
    ]
  },
  {
    id: "semiconductor-king",
    name: "Semiconductor King",
    theme: "High Growth & Innovation",
    risk: 5,
    summary: "Pure bet on the hardware of the future.",
    holdings: [{ symbol: "SMH", weight: 100 }]
  },
  {
    id: "the-disruptor",
    name: "The Disruptor",
    theme: "High Growth & Innovation",
    risk: 5,
    summary: "Moonshot bets on world-changing tech.",
    holdings: [{ symbol: "ARKK", weight: 100 }]
  },
  {
    id: "dividend-aristocrats",
    name: "Dividend Aristocrats",
    theme: "Income & Dividends",
    risk: 3,
    summary: "Companies that raise payouts every year.",
    holdings: [{ symbol: "NOBL", weight: 100 }]
  },
  {
    id: "high-yield-monthly",
    name: "High Yield Monthly",
    theme: "Income & Dividends",
    risk: 2,
    summary: "Immediate cash sent to you every 30 days.",
    holdings: [{ symbol: "JEPI", weight: 100 }]
  },
  {
    id: "quality-div-growth",
    name: "Quality Div. Growth",
    theme: "Income & Dividends",
    risk: 3,
    summary: "Strong companies with safe, growing payouts.",
    holdings: [{ symbol: "SCHD", weight: 100 }]
  },
  {
    id: "all-weather",
    name: "All-Weather",
    theme: "Defensive & Conservative",
    risk: 2,
    summary: "Built to grow in any economic climate.",
    holdings: [
      { symbol: "VTI", weight: 30 },
      { symbol: "TLT", weight: 40 },
      { symbol: "IEF", weight: 15 },
      { symbol: "GLD", weight: 7.5 },
      { symbol: "GSG", weight: 7.5 }
    ]
  },
  {
    id: "golden-hedge",
    name: "The Golden Hedge",
    theme: "Defensive & Conservative",
    risk: 2,
    summary: "A split between gold and short-term Treasuries.",
    holdings: [
      { symbol: "GLD", weight: 50 },
      { symbol: "SGOV", weight: 50 }
    ]
  },
  {
    id: "inflation-shield",
    name: "Inflation Shield",
    theme: "Defensive & Conservative",
    risk: 2,
    summary: "Protects your money when prices rise.",
    holdings: [
      { symbol: "VTI", weight: 40 },
      { symbol: "SCHP", weight: 40 },
      { symbol: "IAU", weight: 20 }
    ]
  },
  {
    id: "savings-substitute",
    name: "Savings Substitute",
    theme: "Defensive & Conservative",
    risk: 1,
    summary: "Better interest than a bank, almost zero risk.",
    holdings: [{ symbol: "SGOV", weight: 100 }]
  },
  {
    id: "green-frontier",
    name: "The Green Frontier",
    theme: "Thematic & Specialty",
    risk: 5,
    summary: "Investing in solar, wind, and renewables.",
    holdings: [{ symbol: "ICLN", weight: 100 }]
  },
  {
    id: "multipolar-world",
    name: "Multipolar World",
    theme: "Thematic & Specialty",
    risk: 4,
    summary: "Growth in India, Brazil, and Southeast Asia.",
    holdings: [
      { symbol: "VTI", weight: 50 },
      { symbol: "VWO", weight: 50 }
    ]
  },
  {
    id: "canadian-powerhouse",
    name: "Canadian Powerhouse",
    theme: "Thematic & Specialty",
    risk: 3,
    summary: "The best of Canada: banks, energy, and tech.",
    holdings: [{ symbol: "VCN", weight: 100 }]
  },
  {
    id: "real-estate-mogul",
    name: "Real Estate Mogul",
    theme: "Thematic & Specialty",
    risk: 4,
    summary: "Own property via stock-market REITs.",
    holdings: [{ symbol: "VNQ", weight: 100 }]
  },
  {
    id: "space-defense",
    name: "Space & Defense",
    theme: "Thematic & Specialty",
    risk: 4,
    summary: "Aerospace and national security tech.",
    holdings: [
      { symbol: "ITA", weight: 50 },
      { symbol: "ROKT", weight: 50 }
    ]
  }
];
