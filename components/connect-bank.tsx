"use client";

import { useEffect, useState } from "react";
import { usePlaidLink } from "react-plaid-link";

export default function ConnectBank() {
  const [linkToken, setLinkToken] = useState<string | null>(null);

  useEffect(() => {
    async function createLinkToken() {
      const res = await fetch("/api/create-link-token", {
        method: "POST",
      });

      const data = await res.json();
      setLinkToken(data.link_token);
    }

    createLinkToken();
  }, []);

  const onSuccess = async (public_token: string) => {
    await fetch("/api/exchange-public-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ public_token }),
    });

    alert("Bank connected successfully!");
  };

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
  });

  return (
    <button
      onClick={() => open()}
      disabled={!ready}
      className="bg-black text-white px-4 py-2 rounded"
    >
      Connect Bank
    </button>
  );
}