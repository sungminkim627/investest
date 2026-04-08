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
  portfolioProjection: SeriesPoint[];
  metrics: PortfolioMetrics;
  riskScore: number;
}

export interface BenchmarkResponse {
  benchmarkSeries: SeriesPoint[];
  benchmarkProjection: SeriesPoint[];
  metrics: PortfolioMetrics;
  riskScore: number;
}
