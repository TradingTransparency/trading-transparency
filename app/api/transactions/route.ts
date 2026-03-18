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
    const { user_id } = body;

    if (!user_id) {
      return NextResponse.json(
        { error: "Missing user_id" },
        { status: 400 }
      );
    }

    const { data: plaidItem, error: fetchError } = await supabaseAdmin
      .from("plaid_items")
      .select("access_token")
      .eq("user_id", user_id)
      .single();

    if (fetchError || !plaidItem?.access_token) {
      console.error("SUPABASE FETCH ERROR:", fetchError);
      return NextResponse.json(
        { error: "No Plaid access token found for user" },
        { status: 404 }
      );
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 365);

    const endDate = new Date();

    const response = await plaidClient.transactionsGet({
      access_token: plaidItem.access_token,
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