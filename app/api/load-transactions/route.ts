import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const { user_id } = await req.json();

    if (!user_id) {
      return NextResponse.json(
        { error: "Missing user_id" },
        { status: 400 }
      );
    }

    const pageSize = 1000;
    let from = 0;
    let allRows: any[] = [];

    while (true) {
      const to = from + pageSize - 1;

      const { data, error } = await supabaseAdmin
        .from("transactions")
        .select("*")
        .eq("user_id", user_id)
        .order("date", { ascending: false })
        .range(from, to);

      if (error) {
        console.error("LOAD TRANSACTIONS ERROR:", error);
        return NextResponse.json({ error }, { status: 500 });
      }

      if (!data || data.length === 0) {
        break;
      }

      allRows = allRows.concat(data);

      if (data.length < pageSize) {
        break;
      }

      from += pageSize;
    }

    return NextResponse.json({ transactions: allRows });
  } catch (err) {
    console.error("LOAD TRANSACTIONS SERVER ERROR:", err);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}