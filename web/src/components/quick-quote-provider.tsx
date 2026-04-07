"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import QuickQuoteDrawer from "@/components/quick-quote-drawer";
import CustomerPickerDrawer from "@/components/customer-picker-drawer";
import { useBooking } from "@/components/booking-provider";
import type { InitialSchedule } from "@/components/booking-wizard";

interface QuickQuoteContextValue {
  drawerOpen: boolean;
  openQuickQuote: () => void;
  closeQuickQuote: () => void;
  openCustomerPicker: (schedule: InitialSchedule) => void;
}

const QuickQuoteContext = createContext<QuickQuoteContextValue>({
  drawerOpen: false,
  openQuickQuote: () => {},
  closeQuickQuote: () => {},
  openCustomerPicker: () => {},
});

export function useQuickQuote() {
  return useContext(QuickQuoteContext);
}

export function QuickQuoteProvider({ children }: { children: ReactNode }) {
  const { openWizard } = useBooking();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  // Customer picker state — lives here so it survives QuickQuoteDrawer remount
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [pendingSchedule, setPendingSchedule] = useState<InitialSchedule | undefined>();

  const openQuickQuote = useCallback(() => {
    setDrawerOpen(true);
  }, []);

  const closeQuickQuote = useCallback(() => {
    setDrawerOpen(false);
    setResetKey((k) => k + 1);
  }, []);

  const openCustomerPicker = useCallback((schedule: InitialSchedule) => {
    setPendingSchedule(schedule);
    setCustomerPickerOpen(true);
  }, []);

  const handleCustomerSelected = useCallback((opts: { customerId?: string; initialSchedule?: InitialSchedule }) => {
    setCustomerPickerOpen(false);
    openWizard({
      customerId: opts.customerId,
      initialSchedule: opts.initialSchedule,
    });
  }, [openWizard]);

  return (
    <QuickQuoteContext.Provider value={{ drawerOpen, openQuickQuote, closeQuickQuote, openCustomerPicker }}>
      {children}
      <QuickQuoteDrawer key={resetKey} />
      <CustomerPickerDrawer
        open={customerPickerOpen}
        onClose={() => setCustomerPickerOpen(false)}
        onSelect={handleCustomerSelected}
        initialSchedule={pendingSchedule}
      />
    </QuickQuoteContext.Provider>
  );
}
