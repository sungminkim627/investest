import { NextRequest, NextResponse } from "next/server";
import { getOrFetchPricesForSymbols } from "@/lib/portfolio/cache";

export async function GET(request: NextRequest) {
  try {
    const symbol = request.nextUrl.searchParams.get("symbol");
    const startDate = request.nextUrl.searchParams.get("startDate");
    const endDate = request.nextUrl.searchParams.get("endDate");

    if (!symbol || !startDate || !endDate) {
      return NextResponse.json({ error: "Missing symbol/startDate/endDate" }, { status: 400 });
    }

    const rows = await getOrFetchPricesForSymbols([symbol], startDate, endDate);
    return NextResponse.json({ rows });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 }
    );
  }
}
