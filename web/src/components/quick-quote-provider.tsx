"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import QuickQuoteDrawer from "@/components/quick-quote-drawer";

interface QuickQuoteContextValue {
  drawerOpen: boolean;
  openQuickQuote: () => void;
  closeQuickQuote: () => void;
}

const QuickQuoteContext = createContext<QuickQuoteContextValue>({
  drawerOpen: false,
  openQuickQuote: () => {},
  closeQuickQuote: () => {},
});

export function useQuickQuote() {
  return useContext(QuickQuoteContext);
}

export function QuickQuoteProvider({ children }: { children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const openQuickQuote = useCallback(() => {
    setDrawerOpen(true);
  }, []);

  const closeQuickQuote = useCallback(() => {
    setDrawerOpen(false);
    setResetKey((k) => k + 1);
  }, []);

  return (
    <QuickQuoteContext.Provider value={{ drawerOpen, openQuickQuote, closeQuickQuote }}>
      {children}
      <QuickQuoteDrawer key={resetKey} />
    </QuickQuoteContext.Provider>
  );
}
