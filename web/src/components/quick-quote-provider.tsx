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

  const openQuickQuote = useCallback(() => {
    setDrawerOpen(true);
  }, []);

  const closeQuickQuote = useCallback(() => {
    setDrawerOpen(false);
  }, []);

  return (
    <QuickQuoteContext.Provider value={{ drawerOpen, openQuickQuote, closeQuickQuote }}>
      {children}
      <QuickQuoteDrawer />
    </QuickQuoteContext.Provider>
  );
}
