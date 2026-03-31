import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Modal,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getJobDetail, updateJobStatus, updateJob, failJob } from '../../src/api';
import { useAppTheme, type ThemeColors } from '../../constants/theme';

interface Job {
  id: string;
  job_number: string;
  job_type: string;
  service_type: string;
  status: string;
  priority: string;
  scheduled_date: string;
  scheduled_window_start: string;
  scheduled_window_end: string;
  service_address: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
  } | null;
  customer: {
    first_name: string;
    last_name: string;
    email?: string;
    phone?: string;
  } | null;
  asset: { identifier?: string; subtype?: string; size?: string } | null;
  placement_notes?: string;
  driver_notes?: string;
  notes?: string;
  route_order: number | null;
  drop_off_asset_pin?: string;
  pick_up_asset_pin?: string;
}

const TYPE_COLORS: Record<string, string> = {
  delivery: '#3B82F6',
  pickup: '#F97316',
  exchange: '#8B5CF6',
};
const TYPE_LABELS: Record<string, string> = {
  delivery: 'Delivery',
  pickup: 'Pickup',
  exchange: 'Exchange',
};

const FAIL_REASONS = [
  'Customer not home',
  'Access blocked',
  'Wrong address',
  'Safety concern',
];

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = useAppTheme();

  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dumpster confirmation modal
  const [showDumpsterModal, setShowDumpsterModal] = useState(false);
  const [dumpsterPin, setDumpsterPin] = useState('');

  // Add note modal
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Fail job modal
  const [showFailModal, setShowFailModal] = useState(false);
  const [failReason, setFailReason] = useState('');
  const [customFailReason, setCustomFailReason] = useState('');
  const [failingJob, setFailingJob] = useState(false);

  // Where to next overlay
  const [showWhereNext, setShowWhereNext] = useState(false);

  const fetchJob = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const data = await getJobDetail(id);
      setJob(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load job');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  const handleStatusUpdate = async (newStatus: string) => {
    if (!job || updating) return;
    setUpdating(true);
    try {
      const updated = await updateJobStatus(job.id, newStatus);
      const resolvedStatus = updated.status || newStatus;
      setJob((prev) => (prev ? { ...prev, status: resolvedStatus } : prev));

      // Auto-open Google Maps when "On My Way" is tapped
      if (resolvedStatus === 'en_route' && job.service_address) {
        const a = job.service_address;
        const q = [a.street, a.city, a.state, a.zip].filter(Boolean).join(', ');
        const url = Platform.OS === 'ios'
          ? `maps://?daddr=${encodeURIComponent(q)}`
          : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
        Linking.openURL(url).catch(() => {});
      }

      if (resolvedStatus === 'arrived') {
        // Show dumpster confirmation after arriving
        if (job.job_type === 'delivery' || job.job_type === 'exchange') {
          setDumpsterPin('');
          setShowDumpsterModal(true);
        } else if (job.job_type === 'pickup') {
          setDumpsterPin(job.asset?.identifier || '');
          setShowDumpsterModal(true);
        }
      } else if (resolvedStatus === 'completed') {
        if (job.job_type === 'pickup' || job.job_type === 'exchange') {
          setShowWhereNext(true);
        }
      }
    } catch (err: any) {
      Alert.alert(
        'Error',
        err?.response?.data?.message || err?.message || 'Failed to update status'
      );
    } finally {
      setUpdating(false);
    }
  };

  const handleDumpsterConfirm = async () => {
    if (!job || !dumpsterPin.trim()) {
      Alert.alert('Required', 'Please enter the dumpster number.');
      return;
    }
    setUpdating(true);
    try {
      const field =
        job.job_type === 'pickup' ? 'pick_up_asset_pin' : 'drop_off_asset_pin';
      await updateJob(job.id, { [field]: dumpsterPin.trim() });
      setJob((prev) =>
        prev ? { ...prev, [field]: dumpsterPin.trim() } : prev
      );
      setShowDumpsterModal(false);
    } catch (err: any) {
      Alert.alert(
        'Error',
        err?.response?.data?.message || err?.message || 'Failed to confirm dumpster'
      );
    } finally {
      setUpdating(false);
    }
  };

  const handleAddNote = async () => {
    if (!job || !noteText.trim()) return;
    setSavingNote(true);
    try {
      await updateJob(job.id, { driver_notes: noteText.trim() });
      setJob((prev) =>
        prev ? { ...prev, driver_notes: noteText.trim() } : prev
      );
      setShowNoteModal(false);
      setNoteText('');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to save note');
    } finally {
      setSavingNote(false);
    }
  };

  const handleFailJob = async () => {
    if (!job) return;
    const reason = failReason === 'custom' ? customFailReason.trim() : failReason;
    if (!reason) {
      Alert.alert('Required', 'Please select or enter a reason.');
      return;
    }
    setFailingJob(true);
    try {
      await failJob(job.id, reason);
      setShowFailModal(false);
      Alert.alert('Job Reported', 'The problem has been reported.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to report problem');
    } finally {
      setFailingJob(false);
    }
  };

  const openMaps = () => {
    if (!job?.service_address) return;
    const addr = job.service_address;
    const query = [addr.street, addr.city, addr.state, addr.zip]
      .filter(Boolean)
      .join(', ');
    const url =
      Platform.OS === 'ios'
        ? `maps://?daddr=${encodeURIComponent(query)}`
        : `google.navigation:q=${encodeURIComponent(query)}`;
    Linking.openURL(url);
  };

  const openPhone = (phone: string) => {
    Linking.openURL(`tel:${phone}`);
  };

  const s = makeStyles(colors);

  // Loading state
  if (loading) {
    return (
      <View style={s.loadingContainer}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  // Error state
  if (error || !job) {
    return (
      <View style={s.loadingContainer}>
        <Text style={s.errorText}>{error || 'Job not found'}</Text>
        <TouchableOpacity onPress={() => router.back()} style={s.backLink}>
          <Text style={s.backLinkText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const addr = job.service_address;
  const hasNotes = !!(job.placement_notes || job.driver_notes);
  const typeColor = TYPE_COLORS[job.job_type] || '#71717A';
  const typeLabel = TYPE_LABELS[job.job_type] || job.job_type;
  const sizeLabel = job.asset?.subtype || job.asset?.size || '';

  // Determine which main action to show
  const renderMainAction = () => {
    const status = job.status;

    if (status === 'confirmed' || status === 'dispatched') {
      return (
        <TouchableOpacity
          style={[s.mainActionBtn, { backgroundColor: '#22C55E' }, updating && s.btnDisabled]}
          onPress={() => handleStatusUpdate('en_route')}
          disabled={updating}
        >
          {updating ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={s.mainActionText}>🚛 On My Way</Text>
          )}
        </TouchableOpacity>
      );
    }

    if (status === 'en_route') {
      return (
        <TouchableOpacity
          style={[s.mainActionBtn, { backgroundColor: '#3B82F6' }, updating && s.btnDisabled]}
          onPress={() => handleStatusUpdate('arrived')}
          disabled={updating}
        >
          {updating ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={s.mainActionText}>📍 Arrived</Text>
          )}
        </TouchableOpacity>
      );
    }

    if (status === 'arrived' || status === 'in_progress') {
      return (
        <TouchableOpacity
          style={[s.mainActionBtn, { backgroundColor: '#D97706' }, updating && s.btnDisabled]}
          onPress={() => handleStatusUpdate('completed')}
          disabled={updating}
        >
          {updating ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={s.mainActionText}>✅ Complete Job</Text>
          )}
        </TouchableOpacity>
      );
    }

    if (status === 'completed') {
      return (
        <View>
          <View style={s.completedBanner}>
            <Ionicons name="checkmark-circle" size={22} color={colors.accent} />
            <Text style={s.completedBannerText}>Completed ✓</Text>
          </View>
          {(job.job_type === 'pickup' || job.job_type === 'exchange') && (
            <TouchableOpacity
              style={[s.mainActionBtn, { backgroundColor: '#F97316', marginTop: 10 }]}
              onPress={() =>
                router.push({
                  pathname: '/job/dump-slip',
                  params: {
                    jobId: job.id,
                    customerName: `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim(),
                  },
                })
              }
            >
              <Text style={s.mainActionText}>Enter Dump Slip</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }

    return null;
  };

  return (
    <View style={s.container}>
      {/* HEADER */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={s.headerContent}>
          <View style={s.headerBadges}>
            <View style={[s.headerTypeBadge, { backgroundColor: typeColor }]}>
              <Text style={s.headerTypeBadgeText}>{typeLabel}</Text>
            </View>
            {sizeLabel ? (
              <View style={s.headerSizeBadge}>
                <Text style={s.headerSizeBadgeText}>{sizeLabel}</Text>
              </View>
            ) : null}
          </View>
          <Text style={s.headerJobNumber}>#{job.job_number}</Text>
        </View>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* CUSTOMER CARD */}
        {job.customer && (
          <View style={s.card}>
            <Text style={s.customerName}>
              {job.customer.first_name} {job.customer.last_name}
            </Text>
            {job.customer.phone && (
              <TouchableOpacity
                style={s.contactRow}
                onPress={() => openPhone(job.customer!.phone!)}
              >
                <Ionicons name="call-outline" size={18} color={colors.accent} />
                <Text style={s.contactText}>{job.customer.phone}</Text>
              </TouchableOpacity>
            )}
            {addr && (
              <Text style={s.addressText}>
                {[addr.street, addr.city, addr.state, addr.zip]
                  .filter(Boolean)
                  .join(', ')}
              </Text>
            )}
            {addr && (
              <TouchableOpacity style={s.navigateBtn} onPress={openMaps}>
                <Ionicons name="navigate" size={16} color="#fff" />
                <Text style={s.navigateBtnText}>Navigate</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* NOTES CARD */}
        {(hasNotes || job.notes) && (
          <View style={s.notesCard}>
            {job.placement_notes ? (
              <View style={s.noteSection}>
                <Text style={s.noteLabel}>Placement Notes</Text>
                <Text style={s.noteText}>{job.placement_notes}</Text>
              </View>
            ) : null}
            {job.driver_notes ? (
              <View style={[s.noteSection, job.placement_notes ? { marginTop: 10 } : undefined]}>
                <Text style={s.noteLabel}>Driver Notes</Text>
                <Text style={s.noteText}>{job.driver_notes}</Text>
              </View>
            ) : null}
            {job.notes && !job.placement_notes && !job.driver_notes ? (
              <View style={s.noteSection}>
                <Text style={s.noteLabel}>Notes</Text>
                <Text style={s.noteText}>{job.notes}</Text>
              </View>
            ) : null}
            <TouchableOpacity
              style={s.addNoteBtn}
              onPress={() => {
                setNoteText(job.driver_notes || '');
                setShowNoteModal(true);
              }}
            >
              <Ionicons name="pencil" size={14} color="#D97706" />
              <Text style={s.addNoteBtnText}>Add Note</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Show Add Note even when no notes exist */}
        {!hasNotes && !job.notes && (
          <TouchableOpacity
            style={s.addNoteStandalone}
            onPress={() => {
              setNoteText('');
              setShowNoteModal(true);
            }}
          >
            <Ionicons name="pencil" size={14} color="#D97706" />
            <Text style={s.addNoteBtnText}>Add Note</Text>
          </TouchableOpacity>
        )}

        {/* DUMPSTER CARD */}
        {job.asset?.identifier &&
          (job.job_type === 'delivery' ||
            job.job_type === 'pickup' ||
            job.job_type === 'exchange') && (
            <View style={s.card}>
              <Text style={s.cardLabel}>Dumpster</Text>
              {(job.job_type === 'delivery' || job.job_type === 'exchange') && (
                <Text style={s.dumpsterText}>
                  Drop Off: {job.drop_off_asset_pin || job.asset.identifier}
                  {sizeLabel ? ` (${sizeLabel})` : ''}
                </Text>
              )}
              {(job.job_type === 'pickup' || job.job_type === 'exchange') && (
                <Text style={s.dumpsterText}>
                  Pick Up: {job.pick_up_asset_pin || job.asset.identifier}
                  {sizeLabel ? ` (${sizeLabel})` : ''}
                </Text>
              )}
            </View>
          )}
      </ScrollView>

      {/* ACTION BAR (fixed at bottom) */}
      <View style={s.actionBar}>
        {job.status !== 'completed' && job.status !== 'cancelled' && job.status !== 'failed' && (
          <TouchableOpacity
            style={s.reportProblemBtn}
            onPress={() => {
              setFailReason('');
              setCustomFailReason('');
              setShowFailModal(true);
            }}
          >
            <Text style={s.reportProblemText}>Report Problem</Text>
          </TouchableOpacity>
        )}
        {renderMainAction()}
      </View>

      {/* DUMPSTER CONFIRMATION MODAL */}
      <Modal
        visible={showDumpsterModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDumpsterModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={s.modalOverlay}
        >
          <View style={s.modalContent}>
            <Text style={s.modalTitle}>
              {job.job_type === 'pickup'
                ? 'Confirm dumpster number you\'re picking up'
                : 'Enter dumpster number you\'re dropping off'}
            </Text>
            <TextInput
              style={s.modalInput}
              value={dumpsterPin}
              onChangeText={setDumpsterPin}
              placeholder="e.g. D-2005"
              placeholderTextColor={colors.textTertiary}
              autoFocus
              autoCapitalize="characters"
            />
            <View style={s.modalActions}>
              <TouchableOpacity
                style={s.modalCancelBtn}
                onPress={() => setShowDumpsterModal(false)}
              >
                <Text style={s.modalCancelText}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalConfirmBtn, updating && s.btnDisabled]}
                onPress={handleDumpsterConfirm}
                disabled={updating}
              >
                {updating ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={s.modalConfirmText}>Confirm</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ADD NOTE MODAL */}
      <Modal
        visible={showNoteModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowNoteModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={s.modalOverlay}
        >
          <View style={s.modalContent}>
            <Text style={s.modalTitle}>Driver Note</Text>
            <TextInput
              style={[s.modalInput, { height: 100, textAlignVertical: 'top' }]}
              value={noteText}
              onChangeText={setNoteText}
              placeholder="Enter a note..."
              placeholderTextColor={colors.textTertiary}
              multiline
              autoFocus
            />
            <View style={s.modalActions}>
              <TouchableOpacity
                style={s.modalCancelBtn}
                onPress={() => setShowNoteModal(false)}
              >
                <Text style={s.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.modalConfirmBtn, savingNote && s.btnDisabled]}
                onPress={handleAddNote}
                disabled={savingNote}
              >
                {savingNote ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={s.modalConfirmText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* FAIL JOB MODAL */}
      <Modal
        visible={showFailModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowFailModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={s.modalOverlay}
        >
          <View style={s.modalContent}>
            <Text style={s.modalTitle}>Report a Problem</Text>
            {FAIL_REASONS.map((reason) => (
              <TouchableOpacity
                key={reason}
                style={[
                  s.failReasonOption,
                  failReason === reason && s.failReasonSelected,
                ]}
                onPress={() => {
                  setFailReason(reason);
                  setCustomFailReason('');
                }}
              >
                <Text
                  style={[
                    s.failReasonText,
                    failReason === reason && s.failReasonTextSelected,
                  ]}
                >
                  {reason}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[
                s.failReasonOption,
                failReason === 'custom' && s.failReasonSelected,
              ]}
              onPress={() => setFailReason('custom')}
            >
              <Text
                style={[
                  s.failReasonText,
                  failReason === 'custom' && s.failReasonTextSelected,
                ]}
              >
                Other...
              </Text>
            </TouchableOpacity>
            {failReason === 'custom' && (
              <TextInput
                style={[s.modalInput, { marginTop: 8 }]}
                value={customFailReason}
                onChangeText={setCustomFailReason}
                placeholder="Describe the problem..."
                placeholderTextColor={colors.textTertiary}
                autoFocus
              />
            )}
            <View style={[s.modalActions, { marginTop: 16 }]}>
              <TouchableOpacity
                style={s.modalCancelBtn}
                onPress={() => setShowFailModal(false)}
              >
                <Text style={s.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  s.modalConfirmBtn,
                  { backgroundColor: colors.error },
                  failingJob && s.btnDisabled,
                ]}
                onPress={handleFailJob}
                disabled={failingJob}
              >
                {failingJob ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={s.modalConfirmText}>Submit</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* WHERE TO NEXT OVERLAY */}
      <Modal
        visible={showWhereNext}
        transparent
        animationType="fade"
        onRequestClose={() => setShowWhereNext(false)}
      >
        <View style={s.whereNextOverlay}>
          <View style={s.whereNextContent}>
            <Text style={s.whereNextTitle}>Where to next?</Text>
            <Text style={s.whereNextSubtitle}>Job complete! Choose your next step.</Text>

            {/* Option 1: Go to Dump */}
            <TouchableOpacity
              style={[s.whereNextCard, { borderColor: '#22C55E' }]}
              onPress={() => {
                setShowWhereNext(false);
                router.push({
                  pathname: '/job/dump-slip',
                  params: {
                    jobId: job.id,
                    customerName: `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim(),
                  },
                });
              }}
            >
              <Ionicons name="trash" size={24} color="#22C55E" />
              <View style={s.whereNextCardText}>
                <Text style={s.whereNextCardTitle}>Go to Dump</Text>
                <Text style={s.whereNextCardDesc}>
                  Drop off the load at a dump facility
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
            </TouchableOpacity>

            {/* Option 2: Return to Yard */}
            <TouchableOpacity
              style={[s.whereNextCard, { borderColor: '#3B82F6' }]}
              onPress={() => {
                setShowWhereNext(false);
                Alert.alert(
                  'Return to Yard',
                  'Navigate to RTD Yard - Brockton?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Navigate',
                      onPress: () => {
                        const q = 'RTD Yard, Brockton, MA';
                        const url =
                          Platform.OS === 'ios'
                            ? `maps://?daddr=${encodeURIComponent(q)}`
                            : `google.navigation:q=${encodeURIComponent(q)}`;
                        Linking.openURL(url);
                      },
                    },
                  ]
                );
              }}
            >
              <Ionicons name="home" size={24} color="#3B82F6" />
              <View style={s.whereNextCardText}>
                <Text style={s.whereNextCardTitle}>Return to Yard</Text>
                <Text style={s.whereNextCardDesc}>
                  Stage the dumpster at the yard
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
            </TouchableOpacity>

            {/* Option 3: Next Job */}
            <TouchableOpacity
              style={[s.whereNextCard, { borderColor: colors.border }]}
              onPress={() => {
                setShowWhereNext(false);
                router.back();
              }}
            >
              <Ionicons name="arrow-forward-circle" size={24} color={colors.textSecondary} />
              <View style={s.whereNextCardText}>
                <Text style={s.whereNextCardTitle}>Next Job</Text>
                <Text style={s.whereNextCardDesc}>
                  Skip dump — go to next stop
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={s.whereNextDismiss}
              onPress={() => setShowWhereNext(false)}
            >
              <Text style={s.whereNextDismissText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.background,
    },
    errorText: { fontSize: 16, color: colors.error, marginBottom: 12, textAlign: 'center' },
    backLink: { paddingVertical: 8, paddingHorizontal: 16 },
    backLinkText: { fontSize: 14, color: colors.accent, fontWeight: '600' },

    // Header
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 56,
      paddingBottom: 16,
      backgroundColor: colors.frameBg,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.frameBorder,
    },
    backBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center', marginRight: 8 },
    headerContent: { flex: 1 },
    headerBadges: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    headerTypeBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
    },
    headerTypeBadgeText: { fontSize: 12, fontWeight: '700', color: '#fff', textTransform: 'capitalize' },
    headerSizeBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
      backgroundColor: 'rgba(255,255,255,0.15)',
    },
    headerSizeBadgeText: { fontSize: 12, fontWeight: '700', color: colors.frameText },
    headerJobNumber: { fontSize: 13, color: colors.frameTextMuted },

    // Scroll
    scroll: { flex: 1 },
    scrollContent: { padding: 20, paddingBottom: 20 },

    // Cards
    card: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardLabel: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 6,
    },

    // Customer
    customerName: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 6 },
    contactRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 8,
    },
    contactText: { fontSize: 15, color: colors.accent, fontWeight: '500' },
    addressText: {
      fontSize: 14,
      color: colors.textSecondary,
      marginTop: 10,
      lineHeight: 20,
    },
    navigateBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: 14,
      backgroundColor: colors.accent,
      borderRadius: 24,
      paddingVertical: 12,
    },
    navigateBtnText: { fontSize: 15, fontWeight: '600', color: '#fff' },

    // Notes card
    notesCard: {
      backgroundColor: '#FFFBEB',
      borderRadius: 14,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: '#FDE68A',
      borderLeftWidth: 4,
      borderLeftColor: '#D97706',
    },
    noteSection: {},
    noteLabel: {
      fontSize: 11,
      fontWeight: '600',
      color: '#92400E',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 4,
    },
    noteText: { fontSize: 14, color: '#78350F', lineHeight: 20 },
    addNoteBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 12,
      alignSelf: 'flex-start',
    },
    addNoteBtnText: { fontSize: 13, fontWeight: '600', color: '#D97706' },
    addNoteStandalone: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginBottom: 12,
      alignSelf: 'flex-start',
    },

    // Dumpster
    dumpsterText: { fontSize: 16, fontWeight: '600', color: colors.text, marginTop: 2 },

    // Action bar
    actionBar: {
      paddingHorizontal: 20,
      paddingBottom: 36,
      paddingTop: 12,
      borderTopWidth: 0.5,
      borderTopColor: colors.border,
      backgroundColor: colors.background,
    },
    reportProblemBtn: {
      alignSelf: 'center',
      marginBottom: 10,
      paddingVertical: 6,
      paddingHorizontal: 12,
    },
    reportProblemText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.error,
    },
    mainActionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: 28,
      paddingVertical: 18,
    },
    mainActionText: { fontSize: 18, fontWeight: '700', color: '#fff' },
    btnDisabled: { opacity: 0.6 },
    completedBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.accentSoft,
      borderRadius: 28,
      paddingVertical: 16,
    },
    completedBannerText: { fontSize: 16, fontWeight: '700', color: colors.accent },

    // Modals
    modalOverlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.5)',
    },
    modalContent: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 24,
      paddingBottom: 40,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 16,
    },
    modalInput: {
      backgroundColor: colors.background,
      borderRadius: 12,
      padding: 14,
      fontSize: 16,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
    },
    modalActions: {
      flexDirection: 'row',
      gap: 12,
      marginTop: 16,
    },
    modalCancelBtn: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 14,
      borderRadius: 24,
      borderWidth: 1,
      borderColor: colors.border,
    },
    modalCancelText: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
    modalConfirmBtn: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 14,
      borderRadius: 24,
      backgroundColor: colors.accent,
    },
    modalConfirmText: { fontSize: 15, fontWeight: '700', color: '#fff' },

    // Fail modal
    failReasonOption: {
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 8,
    },
    failReasonSelected: {
      borderColor: colors.error,
      backgroundColor: colors.errorSoft,
    },
    failReasonText: { fontSize: 15, color: colors.text },
    failReasonTextSelected: { color: colors.error, fontWeight: '600' },

    // Where to next
    whereNextOverlay: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.6)',
      padding: 20,
    },
    whereNextContent: {
      width: '100%',
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: 24,
    },
    whereNextTitle: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
      marginBottom: 4,
    },
    whereNextSubtitle: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      marginBottom: 20,
    },
    whereNextCard: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      borderRadius: 14,
      borderWidth: 2,
      marginBottom: 10,
      gap: 12,
    },
    whereNextCardText: { flex: 1 },
    whereNextCardTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
    whereNextCardDesc: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
    whereNextDismiss: {
      alignSelf: 'center',
      marginTop: 10,
      paddingVertical: 8,
      paddingHorizontal: 16,
    },
    whereNextDismissText: { fontSize: 14, color: colors.textSecondary },
  });
