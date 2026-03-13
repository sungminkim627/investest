export type TimeRange = "1Y" | "3Y" | "5Y" | "10Y";

export interface HoldingInput {
  symbol: string;
  weight: number;
}

export interface PricePoint {
  symbol: string;
  date: string;
  adjClose: number;
}

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface PortfolioMetrics {
  annualizedReturn: number;
  annualizedVolatility: number;
  maxDrawdown: number;
}

export interface AnalyzeResponse {
  portfolioSeries: SeriesPoint[];
  benchmarkSeries: SeriesPoint[];
  portfolioProjection: SeriesPoint[];
  benchmarkProjection: SeriesPoint[];
  metrics: PortfolioMetrics;
  benchmarkMetrics: PortfolioMetrics;
  riskScore: number;
  benchmarkRiskScore: number;
  comparisonPoints: {
    label: string;
    portfolioValue: number;
    benchmarkValue: number;
    delta: number;
  }[];
  comparisonSummary: string;
}
