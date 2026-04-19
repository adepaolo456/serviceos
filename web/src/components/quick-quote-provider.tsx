"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import QuickQuoteDrawer from "@/components/quick-quote-drawer";
import SlideOver from "@/components/slide-over";
import NewCustomerForm, { type OrchestrationResult, NEW_CUSTOMER_LABELS } from "@/components/new-customer-form";
import CustomerPickerDrawer from "@/components/customer-picker-drawer";
import BookingWizard from "@/components/booking-wizard";
import { useToast } from "@/components/toast";
import type { InitialSchedule } from "@/components/booking-wizard";
import type { AddressValue } from "@/components/address-autocomplete";

// Full form-state mirror for the QuickQuoteDrawer, captured at Book Now
// time so the user can hit "← Edit Quote" from the CustomerPicker and
// reopen the drawer with prior state restored. pricingResult is
// deliberately NOT included — drawer's pricing recalc effect auto-fires
// from restored size+address, avoiding staleness if tenant rules changed.
export type QuoteSnapshot = {
  selectedSize: string;
  address: AddressValue | null;
  addressDisplay: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  deliveryMethod: "email" | "sms" | "both";
  showSendFields: boolean;
};

interface QuickQuoteContextValue {
  drawerOpen: boolean;
  openQuickQuote: () => void;
  closeQuickQuote: () => void;
  openBookingFlow: (schedule: InitialSchedule, snapshot?: QuoteSnapshot) => void;
  pendingQuoteSnapshot: QuoteSnapshot | null;
  reopenQuoteWithSnapshot: () => void;
}

const QuickQuoteContext = createContext<QuickQuoteContextValue>({
  drawerOpen: false,
  openQuickQuote: () => {},
  closeQuickQuote: () => {},
  openBookingFlow: () => {},
  pendingQuoteSnapshot: null,
  reopenQuoteWithSnapshot: () => {},
});

export function useQuickQuote() {
  return useContext(QuickQuoteContext);
}

export function QuickQuoteProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { toast } = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  // Book Now post-quote flow state — lives here so it survives
  // QuickQuoteDrawer remount. Three modes:
  //   'picker'      → CustomerPickerDrawer open (search existing or "Continue as New")
  //   'wizard'      → BookingWizard open (after picker selected an existing customer)
  //   'newCustomer' → NewCustomerForm open (after picker's "Continue as New" fallback)
  type Mode = 'picker' | 'newCustomer' | 'wizard' | null;
  const [mode, setMode] = useState<Mode>(null);
  const [pendingSchedule, setPendingSchedule] = useState<InitialSchedule | undefined>();
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [pendingQuoteSnapshot, setPendingQuoteSnapshot] = useState<QuoteSnapshot | null>(null);

  const openQuickQuote = useCallback(() => {
    setDrawerOpen(true);
  }, []);

  const closeQuickQuote = useCallback(() => {
    setDrawerOpen(false);
    setResetKey((k) => k + 1);
    // Clear snapshot on every drawer-close path (X-button, Send Quote
    // success, ESC, click-outside). handleBookNow reorders to call
    // this BEFORE openBookingFlow so React batching preserves the new
    // snapshot — last setPendingQuoteSnapshot in the handler wins.
    setPendingQuoteSnapshot(null);
  }, []);

  const openBookingFlow = useCallback((schedule: InitialSchedule, snapshot?: QuoteSnapshot) => {
    setPendingSchedule(schedule);
    setSelectedCustomerId(null);
    setPendingQuoteSnapshot(snapshot ?? null);
    setMode('picker');
  }, []);

  // Called by CustomerPicker's "← Edit Quote" button. Snapshot was set
  // in state at Book Now time (via openBookingFlow); we just close the
  // picker and reopen the drawer so its init effect sees the snapshot.
  const reopenQuoteWithSnapshot = useCallback(() => {
    setMode(null);
    setDrawerOpen(true);
  }, []);

  // Picker callback — routes to BookingWizard (existing customer)
  // or NewCustomerForm (Continue as New). Picker fires onSelect with
  // `{ customerId?, initialSchedule? }` per its prop interface.
  const handlePickerSelect = useCallback(
    (opts: { customerId?: string; initialSchedule?: InitialSchedule }) => {
      if (opts.initialSchedule) setPendingSchedule(opts.initialSchedule);
      setPendingQuoteSnapshot(null);
      if (opts.customerId) {
        setSelectedCustomerId(opts.customerId);
        setMode('wizard');
      } else {
        setMode('newCustomer');
      }
    },
    [],
  );

  const handleFormResult = useCallback((result: OrchestrationResult) => {
    setMode(null);
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
    <QuickQuoteContext.Provider value={{ drawerOpen, openQuickQuote, closeQuickQuote, openBookingFlow, pendingQuoteSnapshot, reopenQuoteWithSnapshot }}>
      {children}
      <QuickQuoteDrawer key={resetKey} />
      <CustomerPickerDrawer
        open={mode === 'picker'}
        onClose={() => { setMode(null); setPendingQuoteSnapshot(null); }}
        onSelect={handlePickerSelect}
        initialSchedule={pendingSchedule}
      />
      <SlideOver
        open={mode === 'newCustomer'}
        onClose={() => setMode(null)}
        title="New Customer"
        side="left"
        wide
      >
        <NewCustomerForm
          initialSchedule={pendingSchedule}
          onOrchestrated={handleFormResult}
          onClose={() => setMode(null)}
        />
      </SlideOver>
      <BookingWizard
        open={mode === 'wizard'}
        onClose={() => setMode(null)}
        prefillCustomerId={selectedCustomerId ?? undefined}
        initialSchedule={pendingSchedule}
        side="left"
        onComplete={(createdJobId) => {
          setMode(null);
          if (createdJobId) router.push(`/jobs/${createdJobId}?postCreate=1`);
        }}
      />
    </QuickQuoteContext.Provider>
  );
}
