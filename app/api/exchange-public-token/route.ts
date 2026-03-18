import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { plaidClient } from "@/lib/plaid";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { public_token, user_id } = body;

    if (!public_token || !user_id) {
      return NextResponse.json(
        { error: "Missing public_token or user_id" },
        { status: 400 }
      );
    }

    const response = await plaidClient.itemPublicTokenExchange({
      public_token,
    });

    const accessToken = response.data.access_token;
    const itemId = response.data.item_id;

    const { error: upsertError } = await supabaseAdmin
      .from("plaid_items")
      .upsert(
        {
          user_id,
          access_token: accessToken,
          item_id: itemId,
        },
        {
          onConflict: "user_id",
        }
      );

    if (upsertError) {
      console.error("SUPABASE UPSERT ERROR:", upsertError);
      return NextResponse.json(
        { error: "Failed to store Plaid item" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      item_id: itemId,
    });
  } catch (error: any) {
    console.error("PLAID EXCHANGE ERROR:", error?.response?.data || error);

    return NextResponse.json(
      { error: "Failed to exchange public token" },
      { status: 500 }
    );
  }
}