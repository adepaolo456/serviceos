"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import BookingWizard, { type InitialSchedule } from "@/components/booking-wizard";

interface BookingContextValue {
  wizardOpen: boolean;
  openWizard: (opts?: { customerId?: string; date?: string; initialSchedule?: InitialSchedule }) => void;
  closeWizard: () => void;
  prefillCustomerId?: string;
  prefillDate?: string;
}

const BookingContext = createContext<BookingContextValue>({
  wizardOpen: false,
  openWizard: () => {},
  closeWizard: () => {},
});

export function useBooking() {
  return useContext(BookingContext);
}

export function BookingProvider({ children, onComplete }: { children: ReactNode; onComplete?: (createdJobId?: string) => void }) {
  const router = useRouter();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [prefillCustomerId, setPrefillCustomerId] = useState<string | undefined>();
  const [prefillDate, setPrefillDate] = useState<string | undefined>();
  const [initialSchedule, setInitialSchedule] = useState<InitialSchedule | undefined>();

  const openWizard = useCallback((opts?: { customerId?: string; date?: string; initialSchedule?: InitialSchedule }) => {
    setPrefillCustomerId(opts?.customerId);
    setPrefillDate(opts?.date);
    setInitialSchedule(opts?.initialSchedule);
    setWizardOpen(true);
  }, []);

  const closeWizard = useCallback(() => {
    setWizardOpen(false);
  }, []);

  const handleComplete = useCallback((createdJobId?: string) => {
    onComplete?.(createdJobId);
    // Navigate to the created job with postCreate flag so billing is surfaced immediately
    if (createdJobId) {
      router.push(`/jobs/${createdJobId}?postCreate=1`);
    }
  }, [onComplete, router]);

  return (
    <BookingContext.Provider value={{ wizardOpen, openWizard, closeWizard, prefillCustomerId, prefillDate }}>
      {children}
      <BookingWizard
        open={wizardOpen}
        onClose={closeWizard}
        onComplete={handleComplete}
        prefillCustomerId={prefillCustomerId}
        prefillDate={prefillDate}
        initialSchedule={initialSchedule}
      />
    </BookingContext.Provider>
  );
}
