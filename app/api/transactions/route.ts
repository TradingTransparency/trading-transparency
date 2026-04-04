import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { plaidClient } from "@/lib/plaid";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Missing Supabase environment variables.");
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

type MinimalTransaction = {
  transaction_id: string;
  name: string;
  merchant_name: string;
  amount: number;
  date: string;
  category: string[];
  pending: boolean;
};

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
    startDate.setDate(startDate.getDate() - 730);

    const endDate = new Date();

    const allTransactions: MinimalTransaction[] = [];
    const pageSize = 200;
    let offset = 0;
    let totalAvailable = 0;

    while (true) {
      const response = await plaidClient.transactionsGet({
        access_token: plaidItem.access_token,
        start_date: startDate.toISOString().split("T")[0],
        end_date: endDate.toISOString().split("T")[0],
        options: {
          count: pageSize,
          offset,
        },
      });

      const batch = response.data.transactions;
      totalAvailable = response.data.total_transactions;

      const minimalBatch: MinimalTransaction[] = batch.map((tx) => ({
        transaction_id: String(tx.transaction_id || ""),
        name: String(tx.name || ""),
        merchant_name: String(tx.merchant_name || tx.name || ""),
        amount: Number(tx.amount),
        date: String(tx.date || ""),
        category: Array.isArray(tx.category) ? tx.category.map(String) : [],
        pending: Boolean(tx.pending),
      }));

      allTransactions.push(...minimalBatch);

      if (allTransactions.length >= totalAvailable || batch.length === 0) {
        break;
      }

      offset += pageSize;
    }

    console.log("PLAID TOTAL RETURNED:", allTransactions.length);
    console.log("PLAID TOTAL AVAILABLE:", totalAvailable);

    return NextResponse.json({
      success: true,
      transactions: allTransactions,
      total_transactions: allTransactions.length,
      total_available: totalAvailable,
    });
  } catch (error: any) {
    const plaidError = error?.response?.data || error;
    console.error("PLAID TRANSACTIONS ERROR:", plaidError);

    if (plaidError?.error_code === "PRODUCT_NOT_READY") {
      return NextResponse.json(
        {
          success: false,
          product_not_ready: true,
          error: "Transactions are still syncing. Try again in a few minutes.",
        },
        { status: 202 }
      );
    }

    return NextResponse.json(
      { success: false, error: "Failed to fetch transactions" },
      { status: 500 }
    );
  }
}