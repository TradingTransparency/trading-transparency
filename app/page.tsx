"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { usePlaidLink } from "react-plaid-link";
import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";

type PropTransaction = {
  transaction_id?: string;
  name: string;
  amount: number;
  date: string;
  category?: string[];
  prop_firm: string;
  type: "expense" | "payout";
};

type DateFilter =
  | "all"
  | "ytd"
  | "last30"
  | "last90"
  | "thisYear"
  | "lastYear"
  | "custom";

const SAVE_BATCH_SIZE = 25;

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

function getUsername(session: Session | null) {
  if (!session?.user) return "";

  const metadata = session.user.user_metadata || {};
  const username =
    metadata.username ||
    metadata.full_name ||
    metadata.name ||
    metadata.display_name;

  if (typeof username === "string" && username.trim()) {
    return username.trim();
  }

  const email = session.user.email || "";
  if (email.includes("@")) {
    return email.split("@")[0];
  }

  return "Trader";
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [usernameInput, setUsernameInput] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup">("signup");
  const [authMessage, setAuthMessage] = useState("");

  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [status, setStatus] = useState("Not connected");
  const [transactions, setTransactions] = useState<PropTransaction[]>([]);
  const [hasLinkedBank, setHasLinkedBank] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const [selectedFirm, setSelectedFirm] = useState("all");
  const [selectedType, setSelectedType] = useState("all");
  const [selectedDateFilter, setSelectedDateFilter] =
    useState<DateFilter>("all");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

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
      try {
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
          setHasLinkedBank(loadedTransactions.length > 0);
        }
      } catch (error) {
        console.error("Failed to load saved transactions:", error);
      }
    };

    const fetchLinkToken = async () => {
      try {
        const response = await fetch("/api/create-link-token", {
          method: "POST",
        });

        const data = await response.json();

        if (data.link_token) {
          setLinkToken(data.link_token);
        } else {
          setStatus("Failed to create Plaid link token.");
        }
      } catch (error) {
        console.error("Failed to fetch link token:", error);
        setStatus("Failed to initialize bank connection.");
      }
    };

    loadTransactions();
    fetchLinkToken();
  }, [session]);

  const handleSignUp = async () => {
    setAuthMessage("");

    if (!email || !password) {
      setAuthMessage("Please enter an email and password.");
      return;
    }

    const metadata =
      usernameInput.trim().length > 0
        ? { username: usernameInput.trim() }
        : undefined;

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: metadata ? { data: metadata } : undefined,
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
    setSelectedDateFilter("all");
    setCustomStartDate("");
    setCustomEndDate("");
    setHasLinkedBank(false);
    setIsRetrying(false);
  };

  const reloadSavedTransactions = async (userId: string) => {
    const reloadResponse = await fetch("/api/load-transactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: userId,
      }),
    });

    const reloadText = await reloadResponse.text();

    let reloadData: any;
    try {
      reloadData = reloadText ? JSON.parse(reloadText) : {};
    } catch (error) {
      console.error("Failed to parse reload response:", reloadText);
      setStatus("Failed to parse saved transactions response.");
      return;
    }

    if (!reloadResponse.ok) {
      console.error("/api/load-transactions failed:", reloadData);
      setStatus(`Failed to reload saved transactions (${reloadResponse.status}).`);
      return;
    }

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
      setHasLinkedBank(loadedTransactions.length > 0);
    }
  };

  const fetchAndSaveTransactions = async (userId: string) => {
    setStatus("Fetching transactions...");

    const transactionsResponse = await fetch("/api/transactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: userId,
      }),
    });

    const transactionsText = await transactionsResponse.text();

    let transactionsData: any;
    try {
      transactionsData = transactionsText ? JSON.parse(transactionsText) : {};
    } catch (error) {
      console.error(
        "Failed to parse /api/transactions response:",
        transactionsText
      );
      setStatus("Failed to parse transactions response.");
      return;
    }

    if (!transactionsResponse.ok) {
      console.error("/api/transactions failed:", transactionsData);
      setStatus(`Transaction fetch failed (${transactionsResponse.status}).`);
      return;
    }

    if (transactionsData.product_not_ready) {
      setStatus(
        "Your bank is still syncing transactions. Try again in a few minutes."
      );
      return;
    }

    if (
      !transactionsData.success ||
      !Array.isArray(transactionsData.transactions)
    ) {
      console.error("Invalid transactions payload:", transactionsData);
      setStatus("Failed to fetch transactions.");
      return;
    }

    const allFetchedTransactions = transactionsData.transactions;

    if (allFetchedTransactions.length === 0) {
      setStatus("No transactions returned from Plaid.");
      await reloadSavedTransactions(userId);
      return;
    }

    // IMPORTANT: include account_id here
    const minimalTransactions = allFetchedTransactions.map((tx: any) => ({
      transaction_id: tx.transaction_id,
      account_id: tx.account_id,
      name: tx.name,
      merchant_name: tx.merchant_name,
      amount: tx.amount,
      date: tx.date,
      category: Array.isArray(tx.category) ? tx.category : [],
      pending: Boolean(tx.pending),
    }));

    const batches = chunkArray(minimalTransactions, SAVE_BATCH_SIZE);

    let totalInserted = 0;
    let totalMatched = 0;

    for (let i = 0; i < batches.length; i += 1) {
      const batch = batches[i];

      setStatus(`Saving transactions... batch ${i + 1} of ${batches.length}`);

      const saveResponse = await fetch("/api/save-transactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: userId,
          transactions: batch,
        }),
      });

      const saveText = await saveResponse.text();

      let saveData: any;
      try {
        saveData = saveText ? JSON.parse(saveText) : {};
      } catch (error) {
        console.error(
          `Failed to parse /api/save-transactions batch ${i + 1}:`,
          saveText
        );
        setStatus(`Save response parse failed on batch ${i + 1}.`);
        return;
      }

      if (!saveResponse.ok || !saveData.success) {
        console.error(`Save batch ${i + 1} failed:`, {
          status: saveResponse.status,
          body: saveData,
        });
        setStatus(`Failed while saving batch ${i + 1} of ${batches.length}.`);
        return;
      }

      totalInserted += Number(saveData.inserted || 0);
      totalMatched += Number(saveData.matched || 0);
    }

    if (totalMatched === 0) {
      setStatus("No prop firm transactions detected.");
    } else if (totalInserted === 0) {
      setStatus("No new transactions to save. Existing data loaded.");
    } else {
      setStatus(
        `Transactions saved successfully. Inserted ${totalInserted} new rows.`
      );
    }

    await reloadSavedTransactions(userId);
  };

  const onSuccess = async (public_token: string) => {
    if (!session?.user?.id) {
      setStatus("User not logged in.");
      return;
    }

    try {
      setStatus("Exchanging token...");

      const exchangeResponse = await fetch("/api/exchange-public-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          public_token,
          user_id: session.user.id,
        }),
      });

      const exchangeText = await exchangeResponse.text();

      let exchangeData: any;
      try {
        exchangeData = exchangeText ? JSON.parse(exchangeText) : {};
      } catch (error) {
        console.error(
          "Failed to parse /api/exchange-public-token response:",
          exchangeText
        );
        setStatus("Failed to parse token exchange response.");
        return;
      }

      if (!exchangeResponse.ok || !exchangeData.success) {
        console.error("Exchange token failed:", exchangeData);
        setStatus("Failed to exchange token.");
        return;
      }

      setHasLinkedBank(true);
      await fetchAndSaveTransactions(session.user.id);
    } catch (error: any) {
      console.error("Plaid connection flow failed:", error);
      setStatus(error?.message || "Something went wrong during bank connection.");
    }
  };

  const handleRetryTransactions = async () => {
    if (!session?.user?.id) {
      setStatus("User not logged in.");
      return;
    }

    try {
      setIsRetrying(true);
      await fetchAndSaveTransactions(session.user.id);
    } catch (error: any) {
      console.error("Retry transactions failed:", error);
      setStatus(
        error?.message || "Something went wrong while retrying transactions."
      );
    } finally {
      setIsRetrying(false);
    }
  };

  const { open, ready } = usePlaidLink({
    token: linkToken || "",
    onSuccess,
  });

  const dateFilteredTransactions = useMemo(() => {
    if (selectedDateFilter === "all") return transactions;

    const now = new Date();
    const currentYear = now.getFullYear();

    return transactions.filter((tx) => {
      const txDate = new Date(`${tx.date}T00:00:00`);
      if (Number.isNaN(txDate.getTime())) return false;

      if (selectedDateFilter === "ytd") {
        const startOfYear = new Date(currentYear, 0, 1);
        return txDate >= startOfYear && txDate <= now;
      }

      if (selectedDateFilter === "last30") {
        const cutoff = new Date();
        cutoff.setDate(now.getDate() - 30);
        return txDate >= cutoff && txDate <= now;
      }

      if (selectedDateFilter === "last90") {
        const cutoff = new Date();
        cutoff.setDate(now.getDate() - 90);
        return txDate >= cutoff && txDate <= now;
      }

      if (selectedDateFilter === "thisYear") {
        return txDate.getFullYear() === currentYear;
      }

      if (selectedDateFilter === "lastYear") {
        return txDate.getFullYear() === currentYear - 1;
      }

      if (selectedDateFilter === "custom") {
        if (!customStartDate && !customEndDate) return true;

        const start = customStartDate
          ? new Date(`${customStartDate}T00:00:00`)
          : null;
        const end = customEndDate
          ? new Date(`${customEndDate}T23:59:59`)
          : null;

        if (start && txDate < start) return false;
        if (end && txDate > end) return false;
        return true;
      }

      return true;
    });
  }, [transactions, selectedDateFilter, customStartDate, customEndDate]);

  const filteredTransactions = useMemo(() => {
    return dateFilteredTransactions.filter((tx) => {
      const matchesFirm =
        selectedFirm === "all" || tx.prop_firm === selectedFirm;
      const matchesType =
        selectedType === "all" || tx.type === selectedType;

      return matchesFirm && matchesType;
    });
  }, [dateFilteredTransactions, selectedFirm, selectedType]);

  const totalExpenses = useMemo(() => {
    return dateFilteredTransactions
      .filter((t) => t.type === "expense")
      .reduce((sum, t) => sum + t.amount, 0);
  }, [dateFilteredTransactions]);

  const totalPayouts = useMemo(() => {
    return dateFilteredTransactions
      .filter((t) => t.type === "payout")
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  }, [dateFilteredTransactions]);

  const netProfit = totalPayouts - totalExpenses;
  const roi = totalExpenses > 0 ? (netProfit / totalExpenses) * 100 : 0;

  const perFirmBreakdown = useMemo(() => {
    const grouped: Record<
      string,
      { spend: number; payouts: number; net: number; count: number }
    > = {};

    for (const tx of dateFilteredTransactions) {
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
  }, [dateFilteredTransactions]);

  const availableFirms = useMemo(() => {
    return [...new Set(dateFilteredTransactions.map((tx) => tx.prop_firm))].sort();
  }, [dateFilteredTransactions]);

  const profitCurveData = useMemo(() => {
    const sorted = [...dateFilteredTransactions].sort((a, b) =>
      a.date.localeCompare(b.date)
    );
    let runningTotal = 0;

    return sorted.map((tx, index) => {
      runningTotal += tx.type === "payout" ? Math.abs(tx.amount) : -tx.amount;

      return {
        index,
        date: tx.date,
        value: runningTotal,
      };
    });
  }, [dateFilteredTransactions]);

  const chartPoints = useMemo(() => {
    if (profitCurveData.length === 0) return "";

    const width = 760;
    const height = 280;
    const padding = 24;

    const values = profitCurveData.map((d) => d.value);
    const minValue = Math.min(...values, 0);
    const maxValue = Math.max(...values, 0);
    const range = maxValue - minValue || 1;

    return profitCurveData
      .map((point, index) => {
        const x =
          padding +
          (index / Math.max(profitCurveData.length - 1, 1)) *
            (width - padding * 2);
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

  const username = getUsername(session);

  const pageStyle: CSSProperties = {
    minHeight: "100vh",
    background:
      "radial-gradient(circle at top, rgba(37,99,235,0.14) 0%, rgba(2,6,23,0) 28%), linear-gradient(180deg, #030712 0%, #071122 28%, #0f172a 48%, #f3f6fb 48%, #eef2f7 100%)",
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    color: "#0f172a",
  };

  const shellStyle: CSSProperties = {
    maxWidth: "1440px",
    margin: "0 auto",
    padding: "24px 24px 72px",
  };

  const heroCard: CSSProperties = {
    background:
      "linear-gradient(135deg, rgba(15,23,42,0.98), rgba(29,78,216,0.72))",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: "30px",
    padding: "32px 34px",
    color: "white",
    boxShadow: "0 24px 70px rgba(0,0,0,0.28)",
    backdropFilter: "blur(10px)",
  };

  const panelStyle: CSSProperties = {
    background: "rgba(255,255,255,0.92)",
    border: "1px solid #dbe4f0",
    borderRadius: "26px",
    padding: "26px",
    boxShadow: "0 12px 28px rgba(15,23,42,0.05)",
  };

  const metricCard = (accent: string): CSSProperties => ({
    background: "rgba(255,255,255,0.96)",
    border: `1px solid ${accent}`,
    borderRadius: "24px",
    padding: "24px",
    boxShadow: "0 10px 26px rgba(15,23,42,0.05)",
  });

  const buttonPrimary: CSSProperties = {
    padding: "14px 20px",
    borderRadius: "16px",
    border: "none",
    background: "white",
    color: "#0f172a",
    fontWeight: 800,
    fontSize: "15px",
    cursor: "pointer",
  };

  const buttonSecondary: CSSProperties = {
    padding: "14px 20px",
    borderRadius: "16px",
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.08)",
    color: "white",
    fontWeight: 800,
    fontSize: "15px",
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

  const labelChip: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    borderRadius: "999px",
    background: "rgba(255,255,255,0.08)",
    color: "rgba(255,255,255,0.90)",
    fontSize: "13px",
    fontWeight: 700,
    border: "1px solid rgba(255,255,255,0.10)",
  };

  if (!session) {
    return (
      <main style={pageStyle}>
        <div style={shellStyle}>
          <div style={{ ...heroCard, maxWidth: "680px", margin: "56px auto" }}>
            <div
              style={{
                fontSize: "12px",
                textTransform: "uppercase",
                letterSpacing: "0.18em",
                color: "#93c5fd",
                marginBottom: "16px",
                fontWeight: 800,
              }}
            >
              Trading Transparency
            </div>

            <h1
              style={{
                fontSize: "52px",
                lineHeight: 1.02,
                margin: "0 0 12px",
                letterSpacing: "-0.03em",
              }}
            >
              Turn prop firm activity into verified trading truth.
            </h1>

            <p
              style={{
                color: "rgba(255,255,255,0.82)",
                fontSize: "17px",
                lineHeight: 1.7,
                marginBottom: "24px",
                maxWidth: "580px",
              }}
            >
              Connect your bank, classify prop firm fees and payouts, and see
              the real numbers behind your trading business.
            </p>

            <div style={{ display: "flex", gap: "10px", marginBottom: "18px" }}>
              <button
                type="button"
                onClick={() => setAuthMode("signup")}
                style={{
                  ...buttonPrimary,
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
                borderRadius: "24px",
                padding: "22px",
                boxShadow: "0 18px 40px rgba(15,23,42,0.16)",
              }}
            >
              {authMode === "signup" && (
                <input
                  type="text"
                  placeholder="Username"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  style={inputStyle}
                />
              )}

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
            <div style={{ maxWidth: "780px" }}>
              <div
                style={{
                  fontSize: "12px",
                  textTransform: "uppercase",
                  letterSpacing: "0.18em",
                  color: "#93c5fd",
                  marginBottom: "16px",
                  fontWeight: 800,
                }}
              >
                Trading Transparency
              </div>

              <h1
                style={{
                  fontSize: "56px",
                  lineHeight: 0.98,
                  margin: "0 0 14px",
                  letterSpacing: "-0.04em",
                }}
              >
                Verified performance dashboard
              </h1>

              <p
                style={{
                  color: "rgba(255,255,255,0.82)",
                  fontSize: "17px",
                  lineHeight: 1.7,
                  margin: "0 0 18px",
                }}
              >
                Built to surface the real economics of prop trading: fees,
                payouts, profitability, and firm-level transparency.
              </p>

              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  flexWrap: "wrap",
                }}
              >
                <div style={labelChip}>User: {username}</div>
                <div style={labelChip}>
                  Range: {selectedDateFilter === "custom" ? "Custom" : selectedDateFilter}
                </div>
                <div style={labelChip}>
                  {dateFilteredTransactions.length} classified transactions
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => open()}
                disabled={!ready || !linkToken}
                style={{
                  ...buttonPrimary,
                  opacity: !ready || !linkToken ? 0.6 : 1,
                  cursor: !ready || !linkToken ? "not-allowed" : "pointer",
                }}
              >
                Connect Bank
              </button>

              {hasLinkedBank && (
                <button
                  type="button"
                  onClick={handleRetryTransactions}
                  disabled={isRetrying}
                  style={{
                    ...buttonPrimary,
                    background: "#dbeafe",
                    color: "#111827",
                    opacity: isRetrying ? 0.6 : 1,
                    cursor: isRetrying ? "not-allowed" : "pointer",
                  }}
                >
                  {isRetrying ? "Retrying..." : "Retry Sync"}
                </button>
              )}

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
              padding: "16px 18px",
              borderRadius: "18px",
              background: "rgba(255,255,255,0.08)",
              color: "white",
              fontWeight: 700,
              fontSize: "15px",
              border: "1px solid rgba(255,255,255,0.10)",
            }}
          >
            Status: {status}
          </div>
        </div>

        <section
          style={{
            marginTop: "30px",
            ...panelStyle,
            padding: "22px 24px",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "12px",
              alignItems: "end",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "13px",
                  color: "#64748b",
                  marginBottom: "8px",
                  fontWeight: 700,
                }}
              >
                Date Range
              </div>
              <select
                value={selectedDateFilter}
                onChange={(e) =>
                  setSelectedDateFilter(e.target.value as DateFilter)
                }
                style={selectStyle}
              >
                <option value="all">All time</option>
                <option value="ytd">YTD</option>
                <option value="last30">Last 30 days</option>
                <option value="last90">Last 90 days</option>
                <option value="thisYear">This year</option>
                <option value="lastYear">Last year</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            {selectedDateFilter === "custom" && (
              <>
                <div>
                  <div
                    style={{
                      fontSize: "13px",
                      color: "#64748b",
                      marginBottom: "8px",
                      fontWeight: 700,
                    }}
                  >
                    Start Date
                  </div>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    style={selectStyle}
                  />
                </div>

                <div>
                  <div
                    style={{
                      fontSize: "13px",
                      color: "#64748b",
                      marginBottom: "8px",
                      fontWeight: 700,
                    }}
                  >
                    End Date
                  </div>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    style={selectStyle}
                  />
                </div>
              </>
            )}

            <div>
              <div
                style={{
                  fontSize: "13px",
                  color: "#64748b",
                  marginBottom: "8px",
                  fontWeight: 700,
                }}
              >
                Firm Filter
              </div>
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
            </div>

            <div>
              <div
                style={{
                  fontSize: "13px",
                  color: "#64748b",
                  marginBottom: "8px",
                  fontWeight: 700,
                }}
              >
                Transaction Type
              </div>
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

            <div
              style={{
                fontSize: "14px",
                color: "#64748b",
                fontWeight: 700,
                paddingBottom: "2px",
              }}
            >
              {dateFilteredTransactions.length} transactions in selected range
            </div>
          </div>
        </section>

        <section
          style={{
            marginTop: "30px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: "18px",
          }}
        >
          <div style={metricCard("#dbeafe")}>
            <div
              style={{
                color: "#64748b",
                fontSize: "14px",
                marginBottom: "12px",
                fontWeight: 700,
              }}
            >
              Total Spend
            </div>
            <div
              style={{
                fontSize: "44px",
                fontWeight: 900,
                lineHeight: 1,
                letterSpacing: "-0.03em",
              }}
            >
              {formatCurrency(totalExpenses)}
            </div>
          </div>

          <div style={metricCard("#dcfce7")}>
            <div
              style={{
                color: "#64748b",
                fontSize: "14px",
                marginBottom: "12px",
                fontWeight: 700,
              }}
            >
              Total Payouts
            </div>
            <div
              style={{
                fontSize: "44px",
                fontWeight: 900,
                lineHeight: 1,
                letterSpacing: "-0.03em",
              }}
            >
              {formatCurrency(totalPayouts)}
            </div>
          </div>

          <div style={metricCard(netProfit >= 0 ? "#dcfce7" : "#fee2e2")}>
            <div
              style={{
                color: "#64748b",
                fontSize: "14px",
                marginBottom: "12px",
                fontWeight: 700,
              }}
            >
              Net Profit
            </div>
            <div
              style={{
                fontSize: "44px",
                fontWeight: 900,
                lineHeight: 1,
                letterSpacing: "-0.03em",
                color: netProfit >= 0 ? "#166534" : "#991b1b",
              }}
            >
              {formatCurrency(netProfit)}
            </div>
          </div>

          <div style={metricCard("#ede9fe")}>
            <div
              style={{
                color: "#64748b",
                fontSize: "14px",
                marginBottom: "12px",
                fontWeight: 700,
              }}
            >
              ROI
            </div>
            <div
              style={{
                fontSize: "44px",
                fontWeight: 900,
                lineHeight: 1,
                letterSpacing: "-0.03em",
              }}
            >
              {formatPercent(roi)}
            </div>
          </div>
        </section>

        <section
          style={{
            marginTop: "30px",
            display: "grid",
            gridTemplateColumns: "1.2fr 0.9fr",
            gap: "22px",
          }}
        >
          <div style={panelStyle}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "16px",
                alignItems: "flex-start",
                flexWrap: "wrap",
                marginBottom: "18px",
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: "22px" }}>
                  Prop Firm Breakdown
                </h2>
                <p style={{ margin: "8px 0 0", color: "#64748b" }}>
                  Categorized spend and payout totals by firm.
                </p>
              </div>
            </div>

            {perFirmBreakdown.length === 0 ? (
              <p style={{ color: "#6b7280" }}>No prop firm activity yet.</p>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: "14px",
                }}
              >
                {perFirmBreakdown.map((firm) => (
                  <div
                    key={firm.firm}
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: "22px",
                      padding: "20px",
                      background:
                        "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 900,
                        fontSize: "18px",
                        textTransform: "capitalize",
                        marginBottom: "12px",
                        color: "#0f172a",
                      }}
                    >
                      {firm.firm}
                    </div>

                    <div
                      style={{
                        color: "#475569",
                        marginBottom: "8px",
                        fontSize: "15px",
                      }}
                    >
                      Spend: {formatCurrency(firm.spend)}
                    </div>

                    <div
                      style={{
                        color: "#475569",
                        marginBottom: "8px",
                        fontSize: "15px",
                      }}
                    >
                      Payouts: {formatCurrency(firm.payouts)}
                    </div>

                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: "15px",
                        color: firm.net >= 0 ? "#166534" : "#b42318",
                        marginBottom: "8px",
                      }}
                    >
                      Net: {formatCurrency(firm.net)}
                    </div>

                    <div
                      style={{
                        color: "#64748b",
                        fontSize: "13px",
                        fontWeight: 700,
                      }}
                    >
                      {firm.count} classified transactions
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={panelStyle}>
            <h2 style={{ marginTop: 0, marginBottom: "18px", fontSize: "22px" }}>
              Transparency Snapshot
            </h2>

            <div
              style={{
                borderRadius: "22px",
                background: "linear-gradient(180deg, #0f172a 0%, #1d4ed8 100%)",
                color: "white",
                padding: "24px",
                marginBottom: "16px",
              }}
            >
              <div
                style={{
                  fontSize: "13px",
                  color: "#bfdbfe",
                  marginBottom: "10px",
                  fontWeight: 700,
                }}
              >
                Performance status
              </div>

              <div
                style={{
                  fontSize: "28px",
                  fontWeight: 900,
                  marginBottom: "12px",
                  letterSpacing: "-0.03em",
                }}
              >
                {netProfit >= 0 ? "Verified profitable" : "Net negative"}
              </div>

              <div
                style={{
                  color: "#dbeafe",
                  lineHeight: 1.7,
                  fontSize: "15px",
                }}
              >
                This dashboard reflects categorized prop firm fees and payouts
                from connected banking activity.
              </div>
            </div>

            <div
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: "20px",
                padding: "20px",
                background: "#ffffff",
              }}
            >
              <div
                style={{
                  fontWeight: 800,
                  marginBottom: "8px",
                  fontSize: "16px",
                }}
              >
                Latest curve value
              </div>

              <div
                style={{
                  fontSize: "32px",
                  fontWeight: 900,
                  color: latestCurveValue >= 0 ? "#166534" : "#991b1b",
                  letterSpacing: "-0.03em",
                }}
              >
                {formatCurrency(latestCurveValue)}
              </div>
            </div>
          </div>
        </section>

        <section style={{ marginTop: "30px", ...panelStyle }}>
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
              <p style={{ margin: "8px 0 0", color: "#64748b" }}>
                Cumulative net profit over the selected date range.
              </p>
            </div>
          </div>

          {profitCurveData.length === 0 ? (
            <div
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: "20px",
                background: "#ffffff",
                padding: "28px",
                color: "#6b7280",
              }}
            >
              No data available yet for the profit curve.
            </div>
          ) : (
            <div
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: "22px",
                background: "linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)",
                padding: "18px",
              }}
            >
              <svg
                viewBox="0 0 760 280"
                style={{ width: "100%", height: "280px", display: "block" }}
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
                  color: "#64748b",
                  fontSize: "14px",
                  fontWeight: 700,
                }}
              >
                <span>{profitCurveData[0]?.date}</span>
                <span>{profitCurveData[profitCurveData.length - 1]?.date}</span>
              </div>
            </div>
          )}
        </section>

        <section style={{ marginTop: "30px", ...panelStyle }}>
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
                Classified Transactions
              </h2>
              <p style={{ margin: "8px 0 0", color: "#64748b" }}>
                {filteredTransactions.length} shown after filters
              </p>
            </div>
          </div>

          {filteredTransactions.length === 0 ? (
            <div
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: "20px",
                background: "#ffffff",
                padding: "28px",
                color: "#6b7280",
              }}
            >
              No transactions match the current filters.
            </div>
          ) : (
            <div style={{ display: "grid", gap: "12px" }}>
              {filteredTransactions.map((tx, index) => (
                <div
                  key={`${tx.transaction_id || "tx"}-${tx.date}-${tx.amount}-${index}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "160px 1fr 180px 180px",
                    gap: "16px",
                    alignItems: "center",
                    border: "1px solid #e2e8f0",
                    borderRadius: "20px",
                    padding: "18px 22px",
                    background: "#ffffff",
                  }}
                >
                  <div
                    style={{
                      color: "#64748b",
                      fontSize: "15px",
                      fontWeight: 700,
                    }}
                  >
                    {tx.date}
                  </div>

                  <div>
                    <div
                      style={{
                        fontWeight: 900,
                        fontSize: "16px",
                        textTransform: "capitalize",
                        marginBottom: "4px",
                      }}
                    >
                      {tx.prop_firm}
                    </div>
                    <div
                      style={{
                        color: "#64748b",
                        fontSize: "13px",
                      }}
                    >
                      {tx.name}
                    </div>
                  </div>

                  <div
                    style={{
                      fontWeight: 800,
                      fontSize: "15px",
                      color: tx.type === "payout" ? "#166534" : "#a14b09",
                      textTransform: "lowercase",
                    }}
                  >
                    {tx.type}
                  </div>

                  <div
                    style={{
                      fontWeight: 900,
                      fontSize: "16px",
                      textAlign: "right",
                    }}
                  >
                    {formatCurrency(Math.abs(tx.amount))}
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