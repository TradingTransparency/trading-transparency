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

    const response = await plaidClient.itemPublicTokenExchange({
      public_token: body.public_token,
    });

    return NextResponse.json({
      access_token: response.data.access_token,
      item_id: response.data.item_id,
    });

  } catch (error: any) {

    console.error("PLAID EXCHANGE ERROR:", error?.response?.data || error);

    return NextResponse.json(
      { error: "Failed to exchange public token" },
      { status: 500 }
    );

  }
}