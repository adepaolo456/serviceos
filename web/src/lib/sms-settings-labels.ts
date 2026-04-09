// Registry of user-facing strings for the SMS settings UI.
// Do not hardcode SMS-related copy in JSX — import from here.

export const SMS_LABELS = {
  sectionTitle: "SMS Configuration",
  numberLabel: "SMS Number",
  noNumber: "No SMS number assigned",
  statusActive: "SMS active",
  statusInactive: "SMS inactive",
  statusNotConfigured: "SMS not configured",
  getSmsNumber: "Get SMS Number",
  editNumber: "Change Number",
  smsBusinessDescription: "Get a dedicated texting number for your business. Customers can receive quotes and updates via text.",
  smsProvisioning: "Setting up your number...",
  smsProvisioningFailed: "Unable to provision a number right now. Please try again later.",
  numberPlaceholder: "(508) 555-1234",
  invalidNumber: "Please enter a valid US phone number",
  // ── Number-removal request flow ──
  requestNumberRemoval: "Request Number Removal",
  smsRemovalPending: "Removal request submitted — awaiting ServiceOS review",
  smsRemovalRequestSubmitted: "Removal request submitted",
  smsRemovalCancel: "Cancel request",
  smsRemovalCancelled: "Request cancelled",
  smsRemovalRejected: "Removal request was declined",
  smsRemovalReleased: "Number was released",
  smsRemovalFailed: "Removal failed — contact support",
  removalModalTitle: "Request SMS number removal",
  removalModalBody:
    "Submitting this request will ask ServiceOS to release your dedicated SMS number. ServiceOS will review the request before any change is made.",
  removalModalBullet1:
    "Customers will no longer be able to text this number once it is released.",
  removalModalBullet2:
    "Monthly billing for the number stops only after the release is processed by ServiceOS.",
  removalModalBullet3:
    "Releasing a number is irreversible — you may not be able to recover the same number.",
  removalModalConfirm: "Submit request",
  removalModalCancel: "Keep number",
  removalSubmitFailed: "Could not submit removal request. Please try again.",
  // ── Read-only mode (non-owner) ──
  readOnlyBanner:
    "You're viewing SMS settings in read-only mode. Ask the account owner to make changes.",
};
