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

    const response = await plaidClient.accountsGet({
      access_token: body.access_token,
    });

    return NextResponse.json({
      accounts: response.data.accounts,
    });
  } catch (error: any) {
    console.error("PLAID ACCOUNTS ERROR:", error?.response?.data || error);

    return NextResponse.json(
      { error: "Failed to fetch accounts" },
      { status: 500 }
    );
  }
}