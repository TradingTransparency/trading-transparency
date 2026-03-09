"use client";

import { useEffect, useMemo, useState } from "react";
import { usePlaidLink } from "react-plaid-link";
import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";

type PlaidTransaction = {
  transaction_id: string;
  name: string;
  amount: number;
  date: string;
  category?: string[];
};

type PropTransaction = PlaidTransaction & {
  prop_firm: string;
  type: "expense" | "payout";
};

const PROP_FIRMS = [
  "apex",
  "topstep",
  "tradeify",
  "lucid",
  "myfundedfutures",
  "bulenox",
  "take profit trader",
];

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("signup");
  const [authMessage, setAuthMessage] = useState("");

  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [status, setStatus] = useState("Not connected");
  const [transactions, setTransactions] = useState<PropTransaction[]>([]);

  useEffect(() => {
    const loadSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      setSession(session);
    };

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;

    const loadTransactions = async () => {
      const response = await fetch("/api/load-transactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: session.user.id,
        }),
      });

      const data = await response.json();

      if (data.transactions) {
        const loadedTransactions: PropTransaction[] = data.transactions.map(
          (tx: any, index: number) => ({
            transaction_id:
              tx.transaction_id ||
              `loaded-${tx.id || `${tx.date}-${tx.merchant}-${tx.amount}-${index}`}`,
            name: tx.merchant,
            amount: tx.amount,
            date: tx.date,
            category: tx.category ? [tx.category] : [],
            prop_firm: tx.prop_firm,
            type: tx.type,
          })
        );

        setTransactions(loadedTransactions);
      }
    };

    const fetchLinkToken = async () => {
      const response = await fetch("/api/create-link-token", {
        method: "POST",
      });

      const data = await response.json();
      setLinkToken(data.link_token);
    };

    loadTransactions();
    fetchLinkToken();
  }, [session]);

  const detectPropTransactions = (
    allTransactions: PlaidTransaction[]
  ): PropTransaction[] => {
    return allTransactions
      .map((transaction) => {
        const lowerName = transaction.name.toLowerCase();

        const matchedFirm = PROP_FIRMS.find((firm) =>
          lowerName.includes(firm)
        );

        if (!matchedFirm) return null;

        return {
          ...transaction,
          prop_firm: matchedFirm,
          type: transaction.amount > 0 ? "expense" : "payout",
        };
      })
      .filter((tx): tx is PropTransaction => tx !== null);
  };

  const handleSignUp = async () => {
    setAuthMessage("");

    if (!email || !password) {
      setAuthMessage("Please enter an email and password.");
      return;
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      setAuthMessage(error.message);
      return;
    }

    setAuthMessage("Signup successful. You can now log in.");
  };

  const handleLogin = async () => {
    setAuthMessage("");

    if (!email || !password) {
      setAuthMessage("Please enter an email and password.");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setAuthMessage(error.message);
      return;
    }

    setAuthMessage("Logged in successfully.");
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setTransactions([]);
    setStatus("Not connected");
    setLinkToken(null);
  };

  const onSuccess = async (public_token: string) => {
    if (!session?.user?.id) {
      setStatus("User not logged in.");
      return;
    }

    setStatus("Exchanging token...");

    const exchangeResponse = await fetch("/api/exchange-public-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ public_token }),
    });

    const exchangeData = await exchangeResponse.json();

    setStatus("Fetching transactions...");

    const transactionsResponse = await fetch("/api/transactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        access_token: exchangeData.access_token,
      }),
    });

    const transactionsData = await transactionsResponse.json();

    const combinedTransactions = [...(transactionsData.transactions || [])];

    const propTransactions = detectPropTransactions(combinedTransactions);

    setTransactions(propTransactions);
    setStatus("Saving transactions...");

    const saveResponse = await fetch("/api/save-transactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: session.user.id,
        transactions: propTransactions,
      }),
    });

    const saveData = await saveResponse.json();

    if (saveData.success) {
      if (saveData.inserted === 0) {
        setStatus("No new transactions to save. Existing data loaded.");
      } else {
        setStatus(
          `Transactions saved successfully. Inserted ${saveData.inserted} new rows.`
        );
      }
    } else {
      setStatus("Failed to save transactions.");
    }

    const reloadResponse = await fetch("/api/load-transactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: session.user.id,
      }),
    });

    const reloadData = await reloadResponse.json();

    if (reloadData.transactions) {
      const loadedTransactions: PropTransaction[] = reloadData.transactions.map(
        (tx: any, index: number) => ({
          transaction_id:
            tx.transaction_id ||
            `loaded-${tx.id || `${tx.date}-${tx.merchant}-${tx.amount}-${index}`}`,
          name: tx.merchant,
          amount: tx.amount,
          date: tx.date,
          category: tx.category ? [tx.category] : [],
          prop_firm: tx.prop_firm,
          type: tx.type,
        })
      );

      setTransactions(loadedTransactions);
    }
  };

  const { open, ready } = usePlaidLink({
    token: linkToken!,
    onSuccess,
  });

  const totalExpenses = useMemo(() => {
    return transactions
      .filter((t) => t.type === "expense")
      .reduce((sum, t) => sum + t.amount, 0);
  }, [transactions]);

  const totalPayouts = useMemo(() => {
    return transactions
      .filter((t) => t.type === "payout")
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  }, [transactions]);

  const netProfit = totalPayouts - totalExpenses;
  const roi = totalExpenses > 0 ? (netProfit / totalExpenses) * 100 : 0;

  const perFirmBreakdown = useMemo(() => {
    const grouped: Record<
      string,
      { spend: number; payouts: number; net: number }
    > = {};

    for (const tx of transactions) {
      if (!grouped[tx.prop_firm]) {
        grouped[tx.prop_firm] = { spend: 0, payouts: 0, net: 0 };
      }

      if (tx.type === "expense") {
        grouped[tx.prop_firm].spend += tx.amount;
      } else {
        grouped[tx.prop_firm].payouts += Math.abs(tx.amount);
      }

      grouped[tx.prop_firm].net =
        grouped[tx.prop_firm].payouts - grouped[tx.prop_firm].spend;
    }

    return Object.entries(grouped).map(([firm, values]) => ({
      firm,
      ...values,
    }));
  }, [transactions]);

  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    background:
      "linear-gradient(180deg, #0b1020 0%, #111827 35%, #f5f7fb 35%, #f5f7fb 100%)",
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    color: "#111827",
  };

  const shellStyle: React.CSSProperties = {
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "32px 24px 64px",
  };

  const heroCard: React.CSSProperties = {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: "20px",
    padding: "28px",
    color: "white",
    boxShadow: "0 20px 50px rgba(0,0,0,0.25)",
    backdropFilter: "blur(6px)",
  };

  const panelStyle: React.CSSProperties = {
    background: "white",
    border: "1px solid #e5e7eb",
    borderRadius: "18px",
    padding: "20px",
    boxShadow: "0 10px 30px rgba(15,23,42,0.06)",
  };

  const metricCard = (accent: string): React.CSSProperties => ({
    background: "white",
    border: `1px solid ${accent}`,
    borderRadius: "18px",
    padding: "20px",
    boxShadow: "0 8px 24px rgba(15,23,42,0.05)",
  });

  const buttonPrimary: React.CSSProperties = {
    padding: "12px 18px",
    borderRadius: "10px",
    border: "none",
    background: "#111827",
    color: "white",
    fontWeight: 600,
    cursor: "pointer",
  };

  const buttonSecondary: React.CSSProperties = {
    padding: "10px 16px",
    borderRadius: "10px",
    border: "1px solid #d1d5db",
    background: "white",
    color: "#111827",
    fontWeight: 600,
    cursor: "pointer",
  };

  const inputStyle: React.CSSProperties = {
    display: "block",
    width: "100%",
    padding: "12px 14px",
    marginBottom: "12px",
    fontSize: "16px",
    border: "1px solid #d1d5db",
    borderRadius: "10px",
    background: "white",
    boxSizing: "border-box",
  };

  if (!session) {
    return (
      <main style={pageStyle}>
        <div style={shellStyle}>
          <div style={{ ...heroCard, maxWidth: "560px", margin: "40px auto" }}>
            <div
              style={{
                fontSize: "12px",
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: "#93c5fd",
                marginBottom: "12px",
                fontWeight: 700,
              }}
            >
              Trading Transparency
            </div>

            <h1
              style={{
                fontSize: "40px",
                lineHeight: 1.05,
                margin: "0 0 12px",
              }}
            >
              See your real prop firm ROI.
            </h1>

            <p
              style={{
                color: "rgba(255,255,255,0.82)",
                fontSize: "16px",
                lineHeight: 1.6,
                marginBottom: "24px",
              }}
            >
              Track evaluation fees, resets, payouts, and net profitability in
              one place.
            </p>

            <div style={{ marginBottom: "18px" }}>
              <button
                type="button"
                onClick={() => setAuthMode("signup")}
                style={{
                  ...buttonPrimary,
                  marginRight: "10px",
                  background: authMode === "signup" ? "white" : "#1f2937",
                  color: authMode === "signup" ? "#111827" : "white",
                }}
              >
                Sign Up
              </button>

              <button
                type="button"
                onClick={() => setAuthMode("login")}
                style={{
                  ...buttonPrimary,
                  background: authMode === "login" ? "white" : "#1f2937",
                  color: authMode === "login" ? "#111827" : "white",
                }}
              >
                Log In
              </button>
            </div>

            <div
              style={{
                background: "white",
                borderRadius: "16px",
                padding: "18px",
              }}
            >
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={inputStyle}
              />

              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={inputStyle}
              />

              {authMode === "signup" ? (
                <button type="button" onClick={handleSignUp} style={buttonPrimary}>
                  Create Account
                </button>
              ) : (
                <button type="button" onClick={handleLogin} style={buttonPrimary}>
                  Log In
                </button>
              )}

              {authMessage && (
                <p style={{ marginTop: "14px", color: "#374151", fontWeight: 600 }}>
                  {authMessage}
                </p>
              )}
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        <div style={heroCard}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "20px",
              alignItems: "flex-start",
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "12px",
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  color: "#93c5fd",
                  marginBottom: "12px",
                  fontWeight: 700,
                }}
              >
                Trading Transparency
              </div>

              <h1 style={{ fontSize: "40px", margin: "0 0 10px" }}>
                Dashboard
              </h1>

              <p style={{ color: "rgba(255,255,255,0.82)", margin: 0 }}>
                Logged in as <strong>{session.user.email}</strong>
              </p>
            </div>

            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => open()}
                disabled={!ready}
                style={{
                  ...buttonPrimary,
                  background: "white",
                  color: "#111827",
                }}
              >
                Connect Bank Account
              </button>

              <button
                type="button"
                onClick={handleLogout}
                style={{
                  ...buttonSecondary,
                  background: "rgba(255,255,255,0.10)",
                  color: "white",
                  border: "1px solid rgba(255,255,255,0.20)",
                }}
              >
                Log Out
              </button>
            </div>
          </div>

          <div
            style={{
              marginTop: "20px",
              padding: "14px 16px",
              borderRadius: "12px",
              background: "rgba(255,255,255,0.08)",
              color: "white",
              fontWeight: 600,
            }}
          >
            Status: {status}
          </div>
        </div>

        <section
          style={{
            marginTop: "28px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "16px",
          }}
        >
          <div style={metricCard("#dbeafe")}>
            <div style={{ color: "#6b7280", fontSize: "13px", marginBottom: "8px" }}>
              Total Spend
            </div>
            <div style={{ fontSize: "30px", fontWeight: 800 }}>
              ${totalExpenses.toFixed(2)}
            </div>
          </div>

          <div style={metricCard("#dcfce7")}>
            <div style={{ color: "#6b7280", fontSize: "13px", marginBottom: "8px" }}>
              Total Payouts
            </div>
            <div style={{ fontSize: "30px", fontWeight: 800 }}>
              ${totalPayouts.toFixed(2)}
            </div>
          </div>

          <div style={metricCard(netProfit >= 0 ? "#dcfce7" : "#fee2e2")}>
            <div style={{ color: "#6b7280", fontSize: "13px", marginBottom: "8px" }}>
              Net Profit
            </div>
            <div
              style={{
                fontSize: "30px",
                fontWeight: 800,
                color: netProfit >= 0 ? "#166534" : "#991b1b",
              }}
            >
              ${netProfit.toFixed(2)}
            </div>
          </div>

          <div style={metricCard("#ede9fe")}>
            <div style={{ color: "#6b7280", fontSize: "13px", marginBottom: "8px" }}>
              ROI
            </div>
            <div style={{ fontSize: "30px", fontWeight: 800 }}>
              {roi.toFixed(2)}%
            </div>
          </div>
        </section>

        <section
          style={{
            marginTop: "28px",
            display: "grid",
            gridTemplateColumns: "1.2fr 1fr",
            gap: "20px",
          }}
        >
          <div style={panelStyle}>
            <h2 style={{ marginTop: 0, marginBottom: "16px" }}>Prop Firm Breakdown</h2>

            {perFirmBreakdown.length === 0 ? (
              <p style={{ color: "#6b7280" }}>No prop firm activity yet.</p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: "14px",
                }}
              >
                {perFirmBreakdown.map((firm) => (
                  <div
                    key={firm.firm}
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: "14px",
                      padding: "16px",
                      background: "#fafafa",
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: "18px",
                        textTransform: "capitalize",
                        marginBottom: "10px",
                      }}
                    >
                      {firm.firm}
                    </div>
                    <div style={{ color: "#4b5563", marginBottom: "6px" }}>
                      Spend: ${firm.spend.toFixed(2)}
                    </div>
                    <div style={{ color: "#4b5563", marginBottom: "6px" }}>
                      Payouts: ${firm.payouts.toFixed(2)}
                    </div>
                    <div
                      style={{
                        fontWeight: 700,
                        color: firm.net >= 0 ? "#166534" : "#991b1b",
                      }}
                    >
                      Net: ${firm.net.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={panelStyle}>
            <h2 style={{ marginTop: 0, marginBottom: "16px" }}>Overview</h2>

            <div
              style={{
                borderRadius: "16px",
                background: "#111827",
                color: "white",
                padding: "20px",
              }}
            >
              <div style={{ fontSize: "13px", color: "#9ca3af", marginBottom: "8px" }}>
                Best performing metric
              </div>
              <div style={{ fontSize: "28px", fontWeight: 800, marginBottom: "10px" }}>
                {netProfit >= 0 ? "Profitable" : "Negative"}
              </div>
              <div style={{ color: "#d1d5db", lineHeight: 1.6 }}>
                Your dashboard is now tracking spend, payouts, and ROI from saved
                transactions in Supabase.
              </div>
            </div>

            <div
              style={{
                marginTop: "16px",
                border: "1px solid #e5e7eb",
                borderRadius: "14px",
                padding: "16px",
                background: "#fafafa",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: "8px" }}>Next build</div>
              <div style={{ color: "#4b5563", lineHeight: 1.6 }}>
                Add charts, dark mode, filters, and a cleaner transactions table.
              </div>
            </div>
          </div>
        </section>

        <section style={{ marginTop: "28px", ...panelStyle }}>
          <h2 style={{ marginTop: 0, marginBottom: "16px" }}>
            Prop Firm Transactions
          </h2>

          {transactions.length === 0 ? (
            <p style={{ color: "#6b7280" }}>No prop firm transactions detected.</p>
          ) : (
            <div style={{ display: "grid", gap: "10px" }}>
              {transactions.map((tx, index) => (
                <div
                  key={`${tx.transaction_id}-${tx.date}-${tx.amount}-${index}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "140px 1fr 120px 120px",
                    gap: "16px",
                    alignItems: "center",
                    border: "1px solid #e5e7eb",
                    borderRadius: "12px",
                    padding: "14px 16px",
                    background: "#fafafa",
                  }}
                >
                  <div style={{ color: "#6b7280", fontSize: "14px" }}>{tx.date}</div>
                  <div style={{ fontWeight: 700, textTransform: "capitalize" }}>
                    {tx.prop_firm}
                  </div>
                  <div
                    style={{
                      fontWeight: 700,
                      color: tx.type === "payout" ? "#166534" : "#92400e",
                    }}
                  >
                    {tx.type}
                  </div>
                  <div style={{ fontWeight: 800, textAlign: "right" }}>
                    ${Math.abs(tx.amount).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}