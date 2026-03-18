import { NextResponse } from "next/server";
import { CountryCode, Products } from "plaid";
import { plaidClient } from "@/lib/plaid";

export async function POST() {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: {
        client_user_id: "test-user",
      },
      client_name: "Trading Transparency",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
    });

    return NextResponse.json({
      link_token: response.data.link_token,
    });
  } catch (error: any) {
    console.error("PLAID ERROR:", error?.response?.data || error);
    return NextResponse.json(
      { error: "Failed to create link token" },
      { status: 500 }
    );
  }
}