import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Missing Supabase environment variables.");
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

type PlaidTransaction = {
  transaction_id?: string;
  account_id?: string;
  name?: string;
  merchant_name?: string;
  date?: string;
  amount?: number | string;
  category?: string[];
  pending?: boolean;
};

type SavedTransactionRow = {
  transaction_id: string;
  account_id: string;
  user_id: string;
  date: string;
  merchant: string;
  amount: number;
  category: string;
  prop_firm: string;
  type: "expense" | "payout";
};

function normalizeMerchantName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function detectPropFirm(name: string) {
  const normalized = normalizeMerchantName(name);

  // Explicit exclusions first
  if (
    normalized.includes("apextrainingtools") ||
    normalized.includes("trainingtools")
  ) {
    return "";
  }

  if (
    normalized.includes("apextraderfunding") ||
    normalized.includes("apextraderfundinginc")
  ) {
    return "apex";
  }

  if (
    normalized.includes("topsteptrader") ||
    normalized === "topstep" ||
    normalized.includes("topstep")
  ) {
    return "topstep";
  }

  if (normalized.includes("tradeify")) {
    return "tradeify";
  }

  if (
    normalized.includes("lucidtrading") ||
    normalized === "lucidtrading"
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

function buildDedupKey(row: {
  user_id: string;
  account_id: string;
  date: string;
  merchant: string;
  amount: number;
  type: "expense" | "payout";
}) {
  return [
    row.user_id.trim(),
    row.account_id.trim(),
    row.date.trim(),
    normalizeMerchantName(row.merchant),
    row.amount.toFixed(2),
    row.type,
  ].join("|");
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { transactions, user_id } = body as {
      transactions?: PlaidTransaction[];
      user_id?: string;
    };

    if (!transactions || !Array.isArray(transactions)) {
      return NextResponse.json(
        { error: "No transactions array received" },
        { status: 400 }
      );
    }

    if (!user_id || typeof user_id !== "string") {
      return NextResponse.json(
        { error: "No valid user_id received" },
        { status: 400 }
      );
    }

    const mappedRows: SavedTransactionRow[] = transactions
      .map((tx) => {
        const transactionId = String(tx.transaction_id || "").trim();
        const accountId = String(tx.account_id || "").trim();
        const merchant = String(tx.merchant_name || tx.name || "").trim();
        const amount = Number(tx.amount);
        const date = String(tx.date || "").trim();
        const category = Array.isArray(tx.category)
          ? String(tx.category[0] || "")
          : "";

        if (!transactionId) return null;
        if (!accountId) return null;
        if (!merchant) return null;
        if (!date) return null;
        if (!Number.isFinite(amount)) return null;
        if (tx.pending) return null;

        const propFirm = detectPropFirm(merchant);
        if (!propFirm) return null;

        return {
          transaction_id: transactionId,
          account_id: accountId,
          user_id,
          date,
          merchant,
          amount,
          category,
          prop_firm: propFirm,
          type: detectTransactionType(amount),
        };
      })
      .filter((row): row is SavedTransactionRow => row !== null);

    if (mappedRows.length === 0) {
      return NextResponse.json({
        success: true,
        received: transactions.length,
        matched: 0,
        inserted: 0,
        message: "No finalized prop firm transactions detected",
      });
    }

    const requestUniqueByTransactionId = new Map<string, SavedTransactionRow>();
    for (const row of mappedRows) {
      requestUniqueByTransactionId.set(row.transaction_id, row);
    }
    const requestDedupedRows = Array.from(requestUniqueByTransactionId.values());

    const { data: existingRows, error: existingError } = await supabaseAdmin
      .from("transactions")
      .select("user_id, account_id, date, merchant, amount, type")
      .eq("user_id", user_id);

    if (existingError) {
      console.error("SUPABASE EXISTING ROWS ERROR:", existingError);
      return NextResponse.json(
        {
          error: "Failed to load existing transactions",
          details: existingError.message,
        },
        { status: 500 }
      );
    }

    const existingKeys = new Set<string>();
    for (const row of existingRows || []) {
      const amount = Number(row.amount);
      if (!Number.isFinite(amount)) continue;
      if (row.type !== "expense" && row.type !== "payout") continue;

      existingKeys.add(
        buildDedupKey({
          user_id: String(row.user_id || ""),
          account_id: String(row.account_id || ""),
          date: String(row.date || ""),
          merchant: String(row.merchant || ""),
          amount,
          type: row.type,
        })
      );
    }

    const rowsToInsert: SavedTransactionRow[] = [];
    const seenBatchKeys = new Set<string>();

    for (const row of requestDedupedRows) {
      const dedupKey = buildDedupKey(row);

      if (existingKeys.has(dedupKey)) {
        continue;
      }

      if (seenBatchKeys.has(dedupKey)) {
        continue;
      }

      seenBatchKeys.add(dedupKey);
      rowsToInsert.push(row);
    }

    if (rowsToInsert.length === 0) {
      return NextResponse.json({
        success: true,
        received: transactions.length,
        matched: mappedRows.length,
        attempted: 0,
        inserted: 0,
        message: "All matched transactions were already saved",
      });
    }

    const { data, error } = await supabaseAdmin
      .from("transactions")
      .upsert(rowsToInsert, {
        onConflict: "transaction_id",
        ignoreDuplicates: true,
      })
      .select();

    if (error) {
      console.error("SUPABASE UPSERT ERROR:", error);
      return NextResponse.json(
        {
          error: "Upsert failed",
          details: error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      received: transactions.length,
      matched: mappedRows.length,
      attempted: rowsToInsert.length,
      inserted: data?.length || 0,
      data,
    });
  } catch (err) {
    console.error("SAVE TRANSACTIONS SERVER ERROR:", err);

    const message =
      err instanceof Error ? err.message : "Unknown server error";

    return NextResponse.json(
      { error: "Server error", details: message },
      { status: 500 }
    );
  }
}