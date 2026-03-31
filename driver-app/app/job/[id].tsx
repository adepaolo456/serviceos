import { useState, useEffect } from 'react';
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
  Image,
  Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { getJobDetail, updateJobStatus, uploadJobPhoto } from '../../src/api';
import { useAppTheme, type ThemeColors } from '../../constants/theme';

interface PhotoEntry {
  uri: string;
  takenAt: string;
  type: string;
}

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
  notes?: string;
  route_order: number | null;
  photos?: PhotoEntry[];
  signature_url?: string;
}

const TYPE_COLORS: Record<string, string> = {
  delivery: '#22C55E',
  pickup: '#F59E0B',
  exchange: '#3B82F6',
};
const TYPE_LABELS: Record<string, string> = {
  delivery: 'Delivery',
  pickup: 'Pickup',
  exchange: 'Exchange',
  dump_run: 'Dump Run',
};

// Simplified 3-step flow: On My Way → Arrived (+ dumpster confirm) → Complete
const STATUS_FLOW: Record<string, { next: string; label: string; icon: string; color: string }> = {
  pending: { next: 'en_route', label: '🚛 On My Way', icon: 'navigate', color: '#22C55E' },
  confirmed: { next: 'en_route', label: '🚛 On My Way', icon: 'navigate', color: '#22C55E' },
  dispatched: { next: 'en_route', label: '🚛 On My Way', icon: 'navigate', color: '#22C55E' },
  en_route: { next: 'arrived', label: '📍 Arrived', icon: 'location', color: '#3B82F6' },
  arrived: { next: 'completed', label: '✅ Complete Job', icon: 'checkmark-done', color: '#D97706' },
  in_progress: { next: 'completed', label: '✅ Complete Job', icon: 'checkmark-done', color: '#D97706' },
};

const PHOTO_TYPES = ['Before', 'After', 'Damage', 'Dump Slip'];

function fmtTime(t: string | null) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hr = parseInt(h);
  return `${hr === 0 ? 12 : hr > 12 ? hr - 12 : hr}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
}

export default function JobDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = useAppTheme();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [signed, setSigned] = useState(false);
  const [showDumpsterModal, setShowDumpsterModal] = useState(false);
  const [dumpsterPin, setDumpsterPin] = useState('');
  const [dumpsterConfirmed, setDumpsterConfirmed] = useState(false);
  const [showWhereNext, setShowWhereNext] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await getJobDetail(id);
        setJob(data);
        if (data.photos && Array.isArray(data.photos)) {
          setPhotos(data.photos);
        }
        if (data.signature_url) {
          setSigned(true);
        }
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const handleStatusUpdate = async () => {
    if (!job) return;
    const transition = STATUS_FLOW[job.status];
    if (!transition) return;

    // For "Complete Job" on arrived status — require dumpster confirmation first
    if ((job.status === 'arrived' || job.status === 'in_progress') && !dumpsterConfirmed) {
      setDumpsterPin(job.asset?.identifier || '');
      setShowDumpsterModal(true);
      return;
    }

    setUpdating(true);
    try {
      const updated = await updateJobStatus(job.id, transition.next);
      const newStatus = updated.status || transition.next;
      setJob((prev) => (prev ? { ...prev, status: newStatus } : prev));

      // Step 1 complete: auto-open Google Maps
      if (newStatus === 'en_route' && job.service_address) {
        const a = job.service_address;
        const q = [a.street, a.city, a.state, a.zip].filter(Boolean).join(', ');
        const url = Platform.OS === 'ios'
          ? `maps://?daddr=${encodeURIComponent(q)}`
          : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
        Linking.openURL(url).catch(() => {});
      }

      // Step 2 complete: show dumpster confirmation
      if (newStatus === 'arrived') {
        setDumpsterPin(job.asset?.identifier || '');
        setShowDumpsterModal(true);
      }

      // Step 3 complete: post-completion routing
      if (newStatus === 'completed') {
        if (job.job_type === 'delivery') {
          Alert.alert('Job Complete! ✓', 'Take a photo of the placed dumpster?', [
            { text: 'Camera', onPress: captureFromCamera },
            { text: 'Skip', style: 'cancel', onPress: () => router.back() },
          ]);
        } else {
          // Pickup or exchange — where to next?
          setShowWhereNext(true);
        }
      }
    } catch (err) {
      Alert.alert('Error', (err as any)?.response?.data?.message || (err as any)?.message || 'Failed to update status');
    } finally {
      setUpdating(false);
    }
  };

  const handleDumpsterConfirm = () => {
    if (!dumpsterPin.trim()) { Alert.alert('Required', 'Enter the dumpster number'); return; }
    setDumpsterConfirmed(true);
    setShowDumpsterModal(false);
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

  const pickPhotoType = (callback: (type: string) => void) => {
    Alert.alert('Photo Type', 'Select the type of photo', [
      ...PHOTO_TYPES.map((t) => ({
        text: t,
        onPress: () => callback(t),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const captureFromCamera = () => {
    pickPhotoType(async (photoType) => {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission required', 'Camera access is needed to take photos.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        base64: true,
        quality: 0.7,
      });
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        const base64 = asset.base64 || '';
        const newPhoto: PhotoEntry = {
          uri: asset.uri,
          takenAt: new Date().toISOString(),
          type: photoType,
        };
        setPhotos((prev) => [...prev, newPhoto]);
        if (job) {
          try {
            await uploadJobPhoto(job.id, base64, photoType);
          } catch {
            /* photo saved locally */
          }
        }
      }
    });
  };

  const pickFromGallery = () => {
    pickPhotoType(async (photoType) => {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission required', 'Gallery access is needed to pick photos.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        base64: true,
        quality: 0.7,
      });
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        const base64 = asset.base64 || '';
        const newPhoto: PhotoEntry = {
          uri: asset.uri,
          takenAt: new Date().toISOString(),
          type: photoType,
        };
        setPhotos((prev) => [...prev, newPhoto]);
        if (job) {
          try {
            await uploadJobPhoto(job.id, base64, photoType);
          } catch {
            /* photo saved locally */
          }
        }
      }
    });
  };

  const handleMarkSigned = () => {
    Alert.alert(
      'Capture Signature',
      'Mark this job as signed by the customer?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm Signature',
          onPress: () => setSigned(true),
        },
      ]
    );
  };

  const s = makeStyles(colors);

  if (loading) {
    return (
      <View style={s.loadingContainer}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (!job) {
    return (
      <View style={s.loadingContainer}>
        <Text style={s.errorText}>Job not found</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={s.backLink}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const addr = job.service_address;
  const transition = STATUS_FLOW[job.status];
  const showSignature = ['arrived', 'in_progress', 'completed'].includes(job.status);

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => { try { router.back(); } catch { router.replace('/(tabs)' as any); } }} style={s.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
          <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600', marginLeft: 6 }}>Back</Text>
        </TouchableOpacity>
        <View style={s.headerContent}>
          <Text style={s.headerTitle} numberOfLines={1}>
            {job.customer
              ? `${job.customer.first_name} ${job.customer.last_name}`
              : job.job_number}
          </Text>
          <View style={s.headerBadges}>
            <View
              style={[
                s.typeBadge,
                {
                  backgroundColor:
                    (TYPE_COLORS[job.job_type] || '#71717A') + '14',
                },
              ]}
            >
              <Text
                style={[
                  s.typeText,
                  { color: TYPE_COLORS[job.job_type] || '#71717A' },
                ]}
              >
                {job.job_type}
              </Text>
            </View>
            <Text style={s.jobNumber}>#{job.job_number}</Text>
          </View>
        </View>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        {/* Quick Actions Row */}
        <View style={s.quickActions}>
          {job.customer?.phone && (
            <TouchableOpacity
              style={s.quickActionBtn}
              onPress={() => Linking.openURL(`tel:${job.customer!.phone}`)}
            >
              <Ionicons name="call" size={20} color={colors.accent} />
              <Text style={s.quickActionLabel}>Call</Text>
            </TouchableOpacity>
          )}
          {job.customer?.email && (
            <TouchableOpacity
              style={s.quickActionBtn}
              onPress={() => Linking.openURL(`mailto:${job.customer!.email}`)}
            >
              <Ionicons name="mail" size={20} color={colors.accent} />
              <Text style={s.quickActionLabel}>Email</Text>
            </TouchableOpacity>
          )}
          {addr && (
            <TouchableOpacity style={s.quickActionBtn} onPress={openMaps}>
              <Ionicons name="navigate" size={20} color={colors.accent} />
              <Text style={s.quickActionLabel}>Navigate</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.quickActionBtn} onPress={captureFromCamera}>
            <Ionicons name="camera" size={20} color={colors.accent} />
            <Text style={s.quickActionLabel}>Photo</Text>
          </TouchableOpacity>
        </View>

        {/* Dumpster Info Card */}
        <View style={[s.card, { borderLeftWidth: 4, borderLeftColor: TYPE_COLORS[job.job_type] || '#71717A' }]}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: '#8A8A8A', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>DUMPSTER</Text>
          <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text, letterSpacing: -0.5 }}>
            {job.asset?.subtype ? job.asset.subtype.replace('yd', ' Yard') + ' Dumpster' : (TYPE_LABELS[job.job_type] || job.job_type)}
          </Text>
          <Text style={{ fontSize: 16, fontWeight: '700', color: TYPE_COLORS[job.job_type] || '#71717A', marginTop: 4 }}>
            {TYPE_LABELS[job.job_type] || job.job_type}
          </Text>
          {job.asset?.identifier && (
            <View style={{ flexDirection: 'row', marginTop: 8 }}>
              <View style={{ backgroundColor: 'rgba(34,197,94,0.08)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#22C55E' }}>{job.asset.identifier}</Text>
              </View>
            </View>
          )}
        </View>

        {/* Status */}
        <View style={s.statusRow}>
          <Text style={s.statusLabel}>Status</Text>
          <Text style={s.statusValue}>{job.status.replace(/_/g, ' ')}</Text>
        </View>

        {/* Customer Card */}
        {job.customer && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Customer</Text>
            <Text style={s.cardValue}>
              {job.customer.first_name} {job.customer.last_name}
            </Text>
            {job.customer.phone && (
              <TouchableOpacity
                style={s.contactRow}
                onPress={() => Linking.openURL(`tel:${job.customer!.phone}`)}
              >
                <Ionicons name="call-outline" size={16} color={colors.accent} />
                <Text style={s.contactText}>{job.customer.phone}</Text>
              </TouchableOpacity>
            )}
            {job.customer.email && (
              <TouchableOpacity
                style={s.contactRow}
                onPress={() => Linking.openURL(`mailto:${job.customer!.email}`)}
              >
                <Ionicons name="mail-outline" size={16} color={colors.accent} />
                <Text style={s.contactText}>{job.customer.email}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Address Card */}
        {addr && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Service Address</Text>
            <Text style={s.cardValue}>
              {[addr.street, addr.city, addr.state, addr.zip]
                .filter(Boolean)
                .join(', ')}
            </Text>
            <TouchableOpacity style={s.navigateBtn} onPress={openMaps}>
              <Ionicons name="navigate" size={16} color="#fff" />
              <Text style={s.navigateBtnText}>Navigate</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Time Window Card */}
        {(job.scheduled_date || job.scheduled_window_start) && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Schedule</Text>
            {job.scheduled_date && (
              <Text style={s.cardValue}>{job.scheduled_date}</Text>
            )}
            {job.scheduled_window_start && (
              <Text style={s.cardSubvalue}>
                {fmtTime(job.scheduled_window_start)}
                {job.scheduled_window_end
                  ? ` - ${fmtTime(job.scheduled_window_end)}`
                  : ''}
              </Text>
            )}
          </View>
        )}

        {/* Asset Card */}
        {job.asset && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Asset</Text>
            {job.asset.identifier && (
              <Text style={s.cardValue}>{job.asset.identifier}</Text>
            )}
            {job.asset.subtype && (
              <Text style={s.cardSubvalue}>{job.asset.subtype}</Text>
            )}
            {job.asset.size && (
              <Text style={s.cardSubvalue}>Size: {job.asset.size}</Text>
            )}
          </View>
        )}

        {/* Notes */}
        {job.notes && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Notes</Text>
            <Text style={s.notesText}>{job.notes}</Text>
          </View>
        )}

        {/* Photos Section */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Photos ({photos.length})</Text>
          {photos.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.photoScroll}>
              {photos.map((p, i) => (
                <View key={i} style={s.photoThumbWrap}>
                  <Image source={{ uri: p.uri }} style={s.photoThumb} />
                  <Text style={s.photoTypeLabel}>{p.type}</Text>
                </View>
              ))}
            </ScrollView>
          )}
          <View style={s.photoActions}>
            <TouchableOpacity style={s.photoCameraBtn} onPress={captureFromCamera}>
              <Ionicons name="camera" size={16} color="#fff" />
              <Text style={s.photoBtnText}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.photoGalleryBtn} onPress={pickFromGallery}>
              <Ionicons name="images" size={16} color={colors.accent} />
              <Text style={s.photoGalleryBtnText}>Gallery</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Signature Section */}
        {showSignature && (
          <View style={s.card}>
            <Text style={s.cardTitle}>Signature</Text>
            {job.signature_url ? (
              <Image source={{ uri: job.signature_url }} style={s.signatureImage} resizeMode="contain" />
            ) : signed ? (
              <View style={s.signedBanner}>
                <Ionicons name="checkmark-circle" size={18} color={colors.accent} />
                <Text style={s.signedText}>Signed</Text>
              </View>
            ) : (
              <TouchableOpacity style={s.signatureBtn} onPress={handleMarkSigned}>
                <Ionicons name="pencil" size={16} color="#fff" />
                <Text style={s.signatureBtnText}>Capture Signature</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>

      {/* Action Button — 3-step flow */}
      {transition && job.status !== 'completed' && (
        <View style={s.actionBar}>
          {/* Show "Complete Job" only after dumpster confirmed on arrived status */}
          {(job.status === 'arrived' || job.status === 'in_progress') && !dumpsterConfirmed ? (
            <TouchableOpacity
              style={[s.actionBtn, { backgroundColor: '#3B82F6' }]}
              onPress={() => { setDumpsterPin(job.asset?.identifier || ''); setShowDumpsterModal(true); }}
            >
              <Ionicons name="cube" size={20} color="#fff" />
              <Text style={s.actionBtnText}>Confirm Dumpster</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[s.actionBtn, { backgroundColor: transition.color }, updating && s.actionBtnDisabled]}
              onPress={handleStatusUpdate}
              disabled={updating}
            >
              {updating ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={s.actionBtnText}>{transition.label}</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      )}

      {job.status === 'completed' && (
        <View style={s.actionBar}>
          <View style={s.completedBanner}>
            <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
            <Text style={s.completedText}>Job Completed</Text>
          </View>
          {(job.job_type === 'pickup' || job.job_type === 'exchange') && (
            <TouchableOpacity
              style={[s.actionBtn, { marginTop: 10, backgroundColor: '#F97316' }]}
              onPress={() => router.push({ pathname: '/job/dump-slip', params: { jobId: job.id, customerName: `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim() } })}
            >
              <Ionicons name="document-text" size={20} color="#fff" />
              <Text style={s.actionBtnText}>Enter Dump Slip</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Dumpster Confirmation Modal */}
      <Modal visible={showDumpsterModal} transparent animationType="slide">
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 4 }}>
              {job.job_type === 'delivery' ? 'Confirm Drop-Off' : job.job_type === 'exchange' ? 'Confirm Exchange' : 'Confirm Pickup'}
            </Text>
            <Text style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 16 }}>
              {job.job_type === 'delivery' ? 'Enter the dumpster number you are dropping off' : 'Enter the dumpster number you are picking up'}
            </Text>
            <View style={{ backgroundColor: colors.surfaceHover, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border, marginBottom: 20 }}>
              <Text style={{ fontSize: 11, fontWeight: '600', color: colors.textSecondary, marginBottom: 4 }}>DUMPSTER NUMBER</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text, flex: 1 }}>{dumpsterPin || '—'}</Text>
                <TouchableOpacity onPress={() => {
                  Alert.prompt ? Alert.prompt('Dumpster #', 'Enter identifier (e.g. D-2005)', (text: string) => setDumpsterPin(text), 'plain-text', dumpsterPin) :
                  Alert.alert('Enter Dumpster #', 'Type the identifier on the Expo keyboard below', [{ text: 'OK' }]);
                }}>
                  <Ionicons name="pencil" size={20} color={colors.accent} />
                </TouchableOpacity>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity onPress={() => setShowDumpsterModal(false)}
                style={{ flex: 1, paddingVertical: 16, borderRadius: 20, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleDumpsterConfirm}
                style={{ flex: 1, paddingVertical: 16, borderRadius: 20, backgroundColor: colors.accent, alignItems: 'center' }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#000' }}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Where to Next? Modal (after completing pickup/exchange) */}
      <Modal visible={showWhereNext} transparent animationType="slide">
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 }}>
            <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text, marginBottom: 4 }}>Where to next?</Text>
            <Text style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 20 }}>You have a full dumpster on the truck</Text>
            <TouchableOpacity onPress={() => {
              setShowWhereNext(false);
              router.push({ pathname: '/job/dump-slip', params: { jobId: job.id, customerName: `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim() } });
            }} style={{ backgroundColor: '#22C55E', borderRadius: 16, padding: 18, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={{ fontSize: 24 }}>🏭</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#000' }}>Go to Dump</Text>
                <Text style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)' }}>Drop off the load at a dump facility</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setShowWhereNext(false); Alert.alert('Return to Yard', 'Bring the dumpster back to the yard', [{ text: 'OK', onPress: () => router.back() }]); }}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 18, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={{ fontSize: 24 }}>🏠</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>Return to Yard</Text>
                <Text style={{ fontSize: 12, color: colors.textSecondary }}>Stage the dumpster at the yard</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setShowWhereNext(false); router.back(); }}
              style={{ alignItems: 'center', paddingVertical: 14 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.textSecondary }}>➡️ Skip — Go to Next Job</Text>
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
    errorText: { fontSize: 16, color: colors.error, marginBottom: 12 },
    backLink: { fontSize: 14, color: colors.accent },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 56,
      paddingBottom: 16,
      borderBottomWidth: 0.5,
      borderBottomColor: colors.border,
    },
    backBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, height: 44, paddingHorizontal: 8, marginRight: 8 },
    headerContent: { flex: 1 },
    headerTitle: { fontSize: 20, fontWeight: '700', color: colors.text, letterSpacing: -0.3 },
    headerBadges: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
    typeBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
    typeText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
    jobNumber: { fontSize: 12, color: colors.textSecondary },
    // Quick Actions
    quickActions: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 20,
      marginBottom: 16,
      paddingVertical: 4,
    },
    quickActionBtn: {
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: colors.accentSoft,
      justifyContent: 'center',
      alignItems: 'center',
    },
    quickActionLabel: {
      fontSize: 9,
      color: colors.textSecondary,
      marginTop: 3,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.3,
    },
    scroll: { flex: 1 },
    scrollContent: { padding: 20, paddingBottom: 40 },
    statusRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
    },
    statusLabel: { fontSize: 13, color: colors.textSecondary },
    statusValue: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
      textTransform: 'capitalize',
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 14,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardTitle: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 6,
    },
    cardValue: { fontSize: 15, fontWeight: '600', color: colors.text },
    cardSubvalue: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
    contactRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 8,
    },
    contactText: { fontSize: 14, color: colors.accent },
    navigateBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: 12,
      backgroundColor: colors.accent,
      borderRadius: 24,
      paddingVertical: 10,
    },
    navigateBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },
    notesText: { fontSize: 14, color: colors.text, lineHeight: 20 },
    // Photos
    photoScroll: { marginBottom: 10 },
    photoThumbWrap: { marginRight: 8, alignItems: 'center' },
    photoThumb: { width: 80, height: 80, borderRadius: 10, backgroundColor: colors.surfaceHover },
    photoTypeLabel: { fontSize: 9, color: colors.textSecondary, marginTop: 3, textTransform: 'uppercase' },
    photoActions: { flexDirection: 'row', gap: 8 },
    photoCameraBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.accent,
      borderRadius: 24,
      paddingVertical: 10,
    },
    photoBtnText: { fontSize: 13, fontWeight: '600', color: '#fff' },
    photoGalleryBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: 'transparent',
      borderRadius: 24,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: colors.border,
    },
    photoGalleryBtnText: { fontSize: 13, fontWeight: '600', color: colors.accent },
    // Signature
    signatureImage: { width: '100%', height: 120, borderRadius: 10, backgroundColor: '#fff' },
    signatureBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.accent,
      borderRadius: 24,
      paddingVertical: 10,
    },
    signatureBtnText: { fontSize: 13, fontWeight: '600', color: '#fff' },
    signedBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: colors.accentSoft,
      borderRadius: 14,
      paddingVertical: 10,
    },
    signedText: { fontSize: 14, fontWeight: '600', color: colors.accent },
    // Action bar
    actionBar: {
      paddingHorizontal: 20,
      paddingBottom: 36,
      paddingTop: 12,
      borderTopWidth: 0.5,
      borderTopColor: colors.border,
    },
    actionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.accent,
      borderRadius: 28,
      paddingVertical: 16,
    },
    actionBtnDisabled: { opacity: 0.6 },
    actionBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
    completedBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.accentSoft,
      borderRadius: 28,
      paddingVertical: 16,
    },
    completedText: { fontSize: 16, fontWeight: '700', color: colors.accent },
  });
