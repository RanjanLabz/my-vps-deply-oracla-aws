"use client";

import { useEffect, useState } from "react";
import { getHealth, getFlowStatus } from "@/lib/api";
import { Wifi, WifiOff, CreditCard } from "lucide-react";

export default function StatusBar() {
  const [health, setHealth] = useState<{
    extension_connected: boolean;
    ws?: { connects: number; disconnects: number };
  } | null>(null);
  const [credits, setCredits] = useState<{ userPaygateTier?: string } | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const h = await getHealth();
        setHealth(h);
      } catch {
        setHealth(null);
      }
      try {
        const c = await getFlowStatus();
        setCredits(c);
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 10000);
    return () => clearInterval(interval);
  }, []);

  const connected = health?.extension_connected ?? false;

  return (
    <header className="h-14 border-b border-border bg-bg-secondary/60 backdrop-blur-xl flex items-center justify-between px-6">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              connected ? "bg-accent-emerald pulse-glow" : "bg-accent-red"
            }`}
          />
          {connected ? (
            <Wifi className="w-4 h-4 text-accent-emerald" />
          ) : (
            <WifiOff className="w-4 h-4 text-accent-red" />
          )}
          <span className="text-sm text-text-secondary">
            {connected ? "Extension Connected" : "Extension Offline"}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {credits?.userPaygateTier && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full glass text-xs">
            <CreditCard className="w-3.5 h-3.5 text-accent-amber" />
            <span className="text-text-secondary">
              {credits.userPaygateTier.replace("PAYGATE_TIER_", "T")}
            </span>
          </div>
        )}
        <div className="text-xs text-text-muted">
          {health?.ws?.connects ?? 0} connects
        </div>
      </div>
    </header>
  );
}
