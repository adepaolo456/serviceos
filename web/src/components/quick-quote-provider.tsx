"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import QuickQuoteDrawer from "@/components/quick-quote-drawer";
import SlideOver from "@/components/slide-over";
import NewCustomerForm, { type OrchestrationResult, NEW_CUSTOMER_LABELS } from "@/components/new-customer-form";
import { useToast } from "@/components/toast";
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
  const router = useRouter();
  const { toast } = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  // New Customer form state — lives here so it survives QuickQuoteDrawer remount
  const [customerFormOpen, setCustomerFormOpen] = useState(false);
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
    setCustomerFormOpen(true);
  }, []);

  const handleFormResult = useCallback((result: OrchestrationResult) => {
    setCustomerFormOpen(false);
    // Atomic create completed — navigate to created job or customer
    switch (result.status) {
      case "booking_created":
      case "invoice_unpaid":
        toast("success", NEW_CUSTOMER_LABELS.bookingCreatedSuccess);
        if (result.jobId) {
          router.push(`/jobs/${result.jobId}?postCreate=1`);
        } else if (result.invoiceId) {
          router.push(`/invoices/${result.invoiceId}`);
        } else {
          router.push(`/customers/${result.customerId}`);
        }
        break;
      case "payment_succeeded":
        toast("success", NEW_CUSTOMER_LABELS.paymentSucceeded);
        router.push(result.jobId ? `/jobs/${result.jobId}?postCreate=1` : `/customers/${result.customerId}`);
        break;
      case "payment_failed":
        toast("error", NEW_CUSTOMER_LABELS.paymentFailed);
        router.push(result.invoiceId ? `/invoices/${result.invoiceId}` : `/customers/${result.customerId}`);
        break;
      case "customer_only":
        toast("success", NEW_CUSTOMER_LABELS.customerCreatedSuccess);
        router.push(`/customers/${result.customerId}`);
        break;
    }
  }, [router, toast]);

  return (
    <QuickQuoteContext.Provider value={{ drawerOpen, openQuickQuote, closeQuickQuote, openCustomerPicker }}>
      {children}
      <QuickQuoteDrawer key={resetKey} />
      <SlideOver
        open={customerFormOpen}
        onClose={() => setCustomerFormOpen(false)}
        title="New Customer"
      >
        <NewCustomerForm
          initialSchedule={pendingSchedule}
          onOrchestrated={handleFormResult}
          onClose={() => setCustomerFormOpen(false)}
        />
      </SlideOver>
    </QuickQuoteContext.Provider>
  );
}
