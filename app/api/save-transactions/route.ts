import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normalizeMerchantName(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function detectPropFirm(name: string) {
  const normalized = normalizeMerchantName(name);

  if (
    normalized.includes("apex") ||
    normalized.includes("apextraderfunding") ||
    normalized.includes("apextraderfundinginc")
  ) {
    return "apex";
  }

  if (
    normalized.includes("topstep") ||
    normalized.includes("topsteptrader")
  ) {
    return "topstep";
  }

  if (normalized.includes("tradeify")) {
    return "tradeify";
  }

  if (
    normalized.includes("lucid") ||
    normalized.includes("lucidtrading")
  ) {
    return "lucid";
  }

  if (
    normalized.includes("myfundedfutures") ||
    normalized.includes("fundedfutures")
  ) {
    return "myfundedfutures";
  }

  if (
    normalized.includes("takeprofittrader") ||
    normalized.includes("takeprofittraderllc") ||
    normalized.includes("takeprofittradpaymentfutureamount") ||
    normalized.includes("takeprofittrad")
  ) {
    return "take profit trader";
  }

  if (normalized.includes("bulenox")) {
    return "bulenox";
  }

  return "";
}

function detectTransactionType(amount: number): "expense" | "payout" {
  return amount < 0 ? "payout" : "expense";
}

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

    const rows = transactions
      .map((tx: any) => {
        const merchant = String(tx.name || "");
        const propFirm = detectPropFirm(merchant);
        const transactionId = String(tx.transaction_id || "").trim();

        if (!propFirm) return null;
        if (!transactionId) return null;

        return {
          transaction_id: transactionId,
          user_id,
          date: tx.date,
          merchant,
          amount: Number(tx.amount),
          category: tx.category?.[0] || "",
          prop_firm: propFirm,
          type: detectTransactionType(Number(tx.amount)),
        };
      })
      .filter(Boolean) as Array<{
      transaction_id: string;
      user_id: string;
      date: string;
      merchant: string;
      amount: number;
      category: string;
      prop_firm: string;
      type: "expense" | "payout";
    }>;

    if (rows.length === 0) {
      return NextResponse.json({
        success: true,
        inserted: 0,
        message: "No prop firm transactions detected",
      });
    }

    const uniqueMap = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      uniqueMap.set(row.transaction_id, row);
    }
    const dedupedRows = Array.from(uniqueMap.values());

    const { data, error } = await supabaseAdmin
      .from("transactions")
      .upsert(dedupedRows, {
        onConflict: "transaction_id",
        ignoreDuplicates: true,
      })
      .select();

    if (error) {
      console.error("SUPABASE UPSERT ERROR:", error);
      return NextResponse.json(
        { error: "Upsert failed", details: error },
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