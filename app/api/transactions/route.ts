import { NextRequest, NextResponse } from "next/server";
import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
} from "plaid";

const config = new Configuration({
  basePath: PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID!,
      "PLAID-SECRET": process.env.PLAID_SECRET!,
    },
  },
});

const plaidClient = new PlaidApi(config);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 365);

    const endDate = new Date();

    const response = await plaidClient.transactionsGet({
      access_token: body.access_token,
      start_date: startDate.toISOString().split("T")[0],
      end_date: endDate.toISOString().split("T")[0],
    });

    return NextResponse.json({
      transactions: response.data.transactions,
    });

  } catch (error: any) {

    console.error("PLAID TRANSACTIONS ERROR:", error?.response?.data || error);

    return NextResponse.json(
      { error: "Failed to fetch transactions" },
      { status: 500 }
    );

  }
}