"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
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

  const [selectedFirm, setSelectedFirm] = useState("all");
  const [selectedType, setSelectedType] = useState("all");

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
            amount: Number(tx.amount),
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
    setSelectedFirm("all");
    setSelectedType("all");
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
          amount: Number(tx.amount),
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

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      const matchesFirm =
        selectedFirm === "all" || tx.prop_firm === selectedFirm;
      const matchesType =
        selectedType === "all" || tx.type === selectedType;

      return matchesFirm && matchesType;
    });
  }, [transactions, selectedFirm, selectedType]);

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
      { spend: number; payouts: number; net: number; count: number }
    > = {};

    for (const tx of transactions) {
      if (!grouped[tx.prop_firm]) {
        grouped[tx.prop_firm] = {
          spend: 0,
          payouts: 0,
          net: 0,
          count: 0,
        };
      }

      grouped[tx.prop_firm].count += 1;

      if (tx.type === "expense") {
        grouped[tx.prop_firm].spend += tx.amount;
      } else {
        grouped[tx.prop_firm].payouts += Math.abs(tx.amount);
      }

      grouped[tx.prop_firm].net =
        grouped[tx.prop_firm].payouts - grouped[tx.prop_firm].spend;
    }

    return Object.entries(grouped)
      .map(([firm, values]) => ({
        firm,
        ...values,
      }))
      .sort((a, b) => b.net - a.net);
  }, [transactions]);

  const availableFirms = useMemo(() => {
    return [...new Set(transactions.map((tx) => tx.prop_firm))].sort();
  }, [transactions]);

  const profitCurveData = useMemo(() => {
    const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
    let runningTotal = 0;

    return sorted.map((tx, index) => {
      runningTotal += tx.type === "payout" ? Math.abs(tx.amount) : -tx.amount;

      return {
        index,
        date: tx.date,
        value: runningTotal,
      };
    });
  }, [transactions]);

  const chartPoints = useMemo(() => {
    if (profitCurveData.length === 0) return "";

    const width = 760;
    const height = 260;
    const padding = 24;

    const values = profitCurveData.map((d) => d.value);
    const minValue = Math.min(...values, 0);
    const maxValue = Math.max(...values, 0);
    const range = maxValue - minValue || 1;

    return profitCurveData
      .map((point, index) => {
        const x =
          padding +
          (index / Math.max(profitCurveData.length - 1, 1)) * (width - padding * 2);
        const y =
          height -
          padding -
          ((point.value - minValue) / range) * (height - padding * 2);

        return `${x},${y}`;
      })
      .join(" ");
  }, [profitCurveData]);

  const latestCurveValue =
    profitCurveData.length > 0
      ? profitCurveData[profitCurveData.length - 1].value
      : 0;

  const pageStyle: CSSProperties = {
    minHeight: "100vh",
    background:
      "linear-gradient(180deg, #030712 0%, #0b1735 38%, #f3f4f6 38%, #f3f4f6 100%)",
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    color: "#111827",
  };

  const shellStyle: CSSProperties = {
    maxWidth: "1400px",
    margin: "0 auto",
    padding: "22px 24px 72px",
  };

  const heroCard: CSSProperties = {
    background: "linear-gradient(135deg, rgba(17,24,39,0.92), rgba(23,37,84,0.88))",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: "28px",
    padding: "30px 34px",
    color: "white",
    boxShadow: "0 24px 70px rgba(0,0,0,0.28)",
    backdropFilter: "blur(8px)",
  };

  const panelStyle: CSSProperties = {
    background: "#f8fafc",
    border: "1px solid #dbe1ea",
    borderRadius: "28px",
    padding: "28px",
    boxShadow: "0 10px 30px rgba(15,23,42,0.04)",
  };

  const metricCard = (borderColor: string): CSSProperties => ({
    background: "#ffffff",
    border: `1px solid ${borderColor}`,
    borderRadius: "24px",
    padding: "24px",
    boxShadow: "0 10px 24px rgba(15,23,42,0.05)",
  });

  const buttonPrimary: CSSProperties = {
    padding: "16px 24px",
    borderRadius: "16px",
    border: "none",
    background: "white",
    color: "#111827",
    fontWeight: 700,
    fontSize: "18px",
    cursor: "pointer",
  };

  const buttonSecondary: CSSProperties = {
    padding: "16px 24px",
    borderRadius: "16px",
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.08)",
    color: "white",
    fontWeight: 700,
    fontSize: "18px",
    cursor: "pointer",
  };

  const inputStyle: CSSProperties = {
    display: "block",
    width: "100%",
    padding: "14px 16px",
    marginBottom: "12px",
    fontSize: "16px",
    border: "1px solid #d1d5db",
    borderRadius: "14px",
    background: "white",
    boxSizing: "border-box",
  };

  const selectStyle: CSSProperties = {
    padding: "12px 14px",
    borderRadius: "12px",
    border: "1px solid #d1d5db",
    background: "white",
    fontSize: "15px",
    color: "#111827",
  };

  if (!session) {
    return (
      <main style={pageStyle}>
        <div style={shellStyle}>
          <div style={{ ...heroCard, maxWidth: "620px", margin: "48px auto" }}>
            <div
              style={{
                fontSize: "13px",
                textTransform: "uppercase",
                letterSpacing: "0.16em",
                color: "#93c5fd",
                marginBottom: "14px",
                fontWeight: 800,
              }}
            >
              Trading Transparency
            </div>

            <h1
              style={{
                fontSize: "48px",
                lineHeight: 1.02,
                margin: "0 0 12px",
              }}
            >
              Track your real prop firm profitability.
            </h1>

            <p
              style={{
                color: "rgba(255,255,255,0.82)",
                fontSize: "17px",
                lineHeight: 1.65,
                marginBottom: "24px",
              }}
            >
              Connect your accounts, detect prop firm fees and payouts, and see
              whether you’re actually profitable.
            </p>

            <div style={{ marginBottom: "18px" }}>
              <button
                type="button"
                onClick={() => setAuthMode("signup")}
                style={{
                  ...buttonPrimary,
                  marginRight: "12px",
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
                borderRadius: "20px",
                padding: "20px",
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
                <p
                  style={{
                    marginTop: "14px",
                    color: "#374151",
                    fontWeight: 700,
                  }}
                >
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
                  fontSize: "13px",
                  textTransform: "uppercase",
                  letterSpacing: "0.16em",
                  color: "#93c5fd",
                  marginBottom: "14px",
                  fontWeight: 800,
                }}
              >
                Trading Transparency
              </div>

              <h1
                style={{
                  fontSize: "56px",
                  lineHeight: 1,
                  margin: "0 0 18px",
                }}
              >
                Dashboard
              </h1>

              <p
                style={{
                  color: "rgba(255,255,255,0.82)",
                  fontSize: "18px",
                  margin: 0,
                }}
              >
                Logged in as <strong>{session.user.email}</strong>
              </p>
            </div>

            <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => open()}
                disabled={!ready}
                style={buttonPrimary}
              >
                Connect Bank Account
              </button>

              <button
                type="button"
                onClick={handleLogout}
                style={buttonSecondary}
              >
                Log Out
              </button>
            </div>
          </div>

          <div
            style={{
              marginTop: "24px",
              padding: "18px 20px",
              borderRadius: "18px",
              background: "rgba(255,255,255,0.08)",
              color: "white",
              fontWeight: 700,
              fontSize: "18px",
            }}
          >
            Status: {status}
          </div>
        </div>

        <section
          style={{
            marginTop: "34px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: "18px",
          }}
        >
          <div style={metricCard("#dbeafe")}>
            <div
              style={{
                color: "#6b7280",
                fontSize: "17px",
                marginBottom: "14px",
              }}
            >
              Total Spend
            </div>
            <div style={{ fontSize: "56px", fontWeight: 800, lineHeight: 1 }}>
              ${totalExpenses.toFixed(2)}
            </div>
          </div>

          <div style={metricCard("#dcfce7")}>
            <div
              style={{
                color: "#6b7280",
                fontSize: "17px",
                marginBottom: "14px",
              }}
            >
              Total Payouts
            </div>
            <div style={{ fontSize: "56px", fontWeight: 800, lineHeight: 1 }}>
              ${totalPayouts.toFixed(2)}
            </div>
          </div>

          <div style={metricCard(netProfit >= 0 ? "#dcfce7" : "#fee2e2")}>
            <div
              style={{
                color: "#6b7280",
                fontSize: "17px",
                marginBottom: "14px",
              }}
            >
              Net Profit
            </div>
            <div
              style={{
                fontSize: "56px",
                fontWeight: 800,
                lineHeight: 1,
                color: netProfit >= 0 ? "#166534" : "#991b1b",
              }}
            >
              ${netProfit.toFixed(2)}
            </div>
          </div>

          <div style={metricCard("#ede9fe")}>
            <div
              style={{
                color: "#6b7280",
                fontSize: "17px",
                marginBottom: "14px",
              }}
            >
              ROI
            </div>
            <div style={{ fontSize: "56px", fontWeight: 800, lineHeight: 1 }}>
              {roi.toFixed(2)}%
            </div>
          </div>
        </section>

        <section
          style={{
            marginTop: "34px",
            display: "grid",
            gridTemplateColumns: "1.2fr 1fr",
            gap: "22px",
          }}
        >
          <div style={panelStyle}>
            <h2 style={{ marginTop: 0, marginBottom: "20px", fontSize: "22px" }}>
              Prop Firm Breakdown
            </h2>

            {perFirmBreakdown.length === 0 ? (
              <p style={{ color: "#6b7280" }}>No prop firm activity yet.</p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: "16px",
                }}
              >
                {perFirmBreakdown.map((firm) => (
                  <div
                    key={firm.firm}
                    style={{
                      border: "1px solid #d7dbe3",
                      borderRadius: "22px",
                      padding: "20px",
                      background: "#fbfbfc",
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: "20px",
                        textTransform: "capitalize",
                        marginBottom: "12px",
                        color: "#111827",
                      }}
                    >
                      {firm.firm}
                    </div>

                    <div
                      style={{
                        color: "#4b5563",
                        marginBottom: "10px",
                        fontSize: "16px",
                      }}
                    >
                      Spend: ${firm.spend.toFixed(2)}
                    </div>

                    <div
                      style={{
                        color: "#4b5563",
                        marginBottom: "10px",
                        fontSize: "16px",
                      }}
                    >
                      Payouts: ${firm.payouts.toFixed(2)}
                    </div>

                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: "16px",
                        color: firm.net >= 0 ? "#166534" : "#b42318",
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
            <h2 style={{ marginTop: 0, marginBottom: "20px", fontSize: "22px" }}>
              Overview
            </h2>

            <div
              style={{
                borderRadius: "22px",
                background: "#07132f",
                color: "white",
                padding: "24px",
              }}
            >
              <div
                style={{
                  fontSize: "15px",
                  color: "#9ca3af",
                  marginBottom: "12px",
                }}
              >
                Best performing metric
              </div>

              <div
                style={{
                  fontSize: "28px",
                  fontWeight: 800,
                  marginBottom: "14px",
                }}
              >
                {netProfit >= 0 ? "Profitable" : "Negative"}
              </div>

              <div
                style={{
                  color: "#d1d5db",
                  lineHeight: 1.7,
                  fontSize: "16px",
                }}
              >
                Your dashboard is tracking spend, payouts, and ROI from saved
                transactions in Supabase.
              </div>
            </div>

            <div
              style={{
                marginTop: "18px",
                border: "1px solid #d7dbe3",
                borderRadius: "20px",
                padding: "20px",
                background: "#fbfbfc",
              }}
            >
              <div
                style={{
                  fontWeight: 800,
                  marginBottom: "10px",
                  fontSize: "18px",
                }}
              >
                Latest curve value
              </div>

              <div
                style={{
                  fontSize: "34px",
                  fontWeight: 800,
                  color: latestCurveValue >= 0 ? "#166534" : "#991b1b",
                }}
              >
                ${latestCurveValue.toFixed(2)}
              </div>
            </div>
          </div>
        </section>

        <section style={{ marginTop: "34px", ...panelStyle }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "16px",
              alignItems: "center",
              flexWrap: "wrap",
              marginBottom: "20px",
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: "22px" }}>Profit Curve</h2>
              <p style={{ margin: "8px 0 0", color: "#6b7280" }}>
                Cumulative net profit over time
              </p>
            </div>
          </div>

          {profitCurveData.length === 0 ? (
            <div
              style={{
                border: "1px solid #d7dbe3",
                borderRadius: "20px",
                background: "#fbfbfc",
                padding: "28px",
                color: "#6b7280",
              }}
            >
              No data available yet for the profit curve.
            </div>
          ) : (
            <div
              style={{
                border: "1px solid #d7dbe3",
                borderRadius: "22px",
                background: "#fbfbfc",
                padding: "18px",
              }}
            >
              <svg
                viewBox="0 0 760 260"
                style={{ width: "100%", height: "260px", display: "block" }}
              >
                <polyline
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={chartPoints}
                />
              </svg>

              <div
                style={{
                  marginTop: "10px",
                  display: "flex",
                  justifyContent: "space-between",
                  color: "#6b7280",
                  fontSize: "14px",
                }}
              >
                <span>{profitCurveData[0]?.date}</span>
                <span>{profitCurveData[profitCurveData.length - 1]?.date}</span>
              </div>
            </div>
          )}
        </section>

        <section style={{ marginTop: "34px", ...panelStyle }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "16px",
              alignItems: "center",
              flexWrap: "wrap",
              marginBottom: "20px",
            }}
          >
            <div>
              <h2 style={{ margin: 0, fontSize: "22px" }}>
                Prop Firm Transactions
              </h2>
              <p style={{ margin: "8px 0 0", color: "#6b7280" }}>
                {filteredTransactions.length} shown
              </p>
            </div>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <select
                value={selectedFirm}
                onChange={(e) => setSelectedFirm(e.target.value)}
                style={selectStyle}
              >
                <option value="all">All firms</option>
                {availableFirms.map((firm) => (
                  <option key={firm} value={firm}>
                    {firm.charAt(0).toUpperCase() + firm.slice(1)}
                  </option>
                ))}
              </select>

              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                style={selectStyle}
              >
                <option value="all">All types</option>
                <option value="expense">Expense</option>
                <option value="payout">Payout</option>
              </select>
            </div>
          </div>

          {filteredTransactions.length === 0 ? (
            <div
              style={{
                border: "1px solid #d7dbe3",
                borderRadius: "20px",
                background: "#fbfbfc",
                padding: "28px",
                color: "#6b7280",
              }}
            >
              No transactions match the current filters.
            </div>
          ) : (
            <div style={{ display: "grid", gap: "14px" }}>
              {filteredTransactions.map((tx, index) => (
                <div
                  key={`${tx.transaction_id}-${tx.date}-${tx.amount}-${index}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "180px 1fr 180px 180px",
                    gap: "16px",
                    alignItems: "center",
                    border: "1px solid #d7dbe3",
                    borderRadius: "22px",
                    padding: "22px 28px",
                    background: "#fbfbfc",
                  }}
                >
                  <div
                    style={{
                      color: "#6b7280",
                      fontSize: "18px",
                    }}
                  >
                    {tx.date}
                  </div>

                  <div
                    style={{
                      fontWeight: 800,
                      fontSize: "18px",
                      textTransform: "capitalize",
                    }}
                  >
                    {tx.prop_firm}
                  </div>

                  <div
                    style={{
                      fontWeight: 800,
                      fontSize: "18px",
                      color: tx.type === "payout" ? "#166534" : "#a14b09",
                      textTransform: "lowercase",
                    }}
                  >
                    {tx.type}
                  </div>

                  <div
                    style={{
                      fontWeight: 800,
                      fontSize: "18px",
                      textAlign: "right",
                    }}
                  >
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