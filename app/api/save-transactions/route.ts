import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { transactions, user_id } = body;

    if (!transactions || !Array.isArray(transactions)) {
      return NextResponse.json(
        { error: "No transactions array received" },
        { status: 400 }
      );
    }

    if (!user_id) {
      return NextResponse.json(
        { error: "No user_id received" },
        { status: 400 }
      );
    }

    const rows = transactions.map((tx: any) => ({
      user_id,
      date: tx.date,
      merchant: tx.name,
      amount: tx.amount,
      category: tx.category?.[0] || "",
      prop_firm: tx.prop_firm || "",
      type: tx.type || "",
    }));

    const seen = new Set<string>();
    const dedupedRows = rows.filter((row) => {
      const key = [
        row.user_id,
        row.date,
        row.merchant,
        row.amount,
        row.prop_firm,
        row.type,
      ].join("|");

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const merchantList = dedupedRows.map((row) => row.merchant);
    const dateList = dedupedRows.map((row) => row.date);
    const amountList = dedupedRows.map((row) => row.amount);

    const { data: existingRows, error: existingError } = await supabase
      .from("transactions")
      .select("id, user_id, date, merchant, amount, prop_firm, type")
      .eq("user_id", user_id)
      .in("merchant", merchantList)
      .in("date", dateList)
      .in("amount", amountList);

    if (existingError) {
      console.error("SUPABASE EXISTING ROWS ERROR:", existingError);
      return NextResponse.json(
        { error: "Failed checking existing rows", details: existingError },
        { status: 500 }
      );
    }

    const existingKeys = new Set(
      (existingRows || []).map((row: any) =>
        [
          row.user_id,
          row.date,
          row.merchant,
          row.amount,
          row.prop_firm || "",
          row.type || "",
        ].join("|")
      )
    );

    const rowsToInsert = dedupedRows.filter((row) => {
      const key = [
        row.user_id,
        row.date,
        row.merchant,
        row.amount,
        row.prop_firm,
        row.type,
      ].join("|");

      return !existingKeys.has(key);
    });

    if (rowsToInsert.length === 0) {
      return NextResponse.json({
        success: true,
        inserted: 0,
        message: "No new transactions to insert",
      });
    }

    const { data, error } = await supabase
      .from("transactions")
      .insert(rowsToInsert)
      .select();

    if (error) {
      console.error("SUPABASE INSERT ERROR:", error);
      return NextResponse.json(
        { error: "Insert failed", details: error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      inserted: data?.length || 0,
      data,
    });
  } catch (err) {
    console.error("SAVE TRANSACTIONS SERVER ERROR:", err);
    return NextResponse.json(
      { error: "Server error", details: err },
      { status: 500 }
    );
  }
}