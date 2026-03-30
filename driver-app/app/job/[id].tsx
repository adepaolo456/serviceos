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
  delivery: '#3B82F6',
  pickup: '#F97316',
  exchange: '#8B5CF6',
};

const STATUS_FLOW: Record<string, { next: string; label: string; icon: string }> = {
  pending: { next: 'confirmed', label: 'Confirm Job', icon: 'checkmark-circle' },
  confirmed: { next: 'en_route', label: 'Start Route', icon: 'navigate' },
  dispatched: { next: 'en_route', label: 'Start Route', icon: 'navigate' },
  en_route: { next: 'arrived', label: 'Mark Arrived', icon: 'location' },
  arrived: { next: 'in_progress', label: 'Start Work', icon: 'hammer' },
  in_progress: { next: 'completed', label: 'Complete Job', icon: 'checkmark-done' },
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
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [signed, setSigned] = useState(false);

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

    Alert.alert(
      transition.label,
      `Update job status to "${transition.next.replace(/_/g, ' ')}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            setUpdating(true);
            try {
              const updated = await updateJobStatus(job.id, transition.next);
              const newStatus = updated.status || transition.next;
              setJob((prev) => (prev ? { ...prev, status: newStatus } : prev));
              if (newStatus === 'en_route') {
                Alert.alert('On My Way!', 'Customer notified — on your way!');
              }
            } catch {
              Alert.alert('Error', 'Failed to update status');
            } finally {
              setUpdating(false);
            }
          },
        },
      ]
    );
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

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2ECC71" />
      </View>
    );
  }

  if (!job) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorText}>Job not found</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backLink}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const addr = job.service_address;
  const transition = STATUS_FLOW[job.status];
  const showSignature = ['arrived', 'in_progress', 'completed'].includes(job.status);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {job.customer
              ? `${job.customer.first_name} ${job.customer.last_name}`
              : job.job_number}
          </Text>
          <View style={styles.headerBadges}>
            <View
              style={[
                styles.typeBadge,
                {
                  backgroundColor:
                    (TYPE_COLORS[job.job_type] || '#71717A') + '20',
                },
              ]}
            >
              <Text
                style={[
                  styles.typeText,
                  { color: TYPE_COLORS[job.job_type] || '#71717A' },
                ]}
              >
                {job.job_type}
              </Text>
            </View>
            <Text style={styles.jobNumber}>#{job.job_number}</Text>
          </View>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Status */}
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Status</Text>
          <Text style={styles.statusValue}>{job.status.replace(/_/g, ' ')}</Text>
        </View>

        {/* Customer Card */}
        {job.customer && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Customer</Text>
            <Text style={styles.cardValue}>
              {job.customer.first_name} {job.customer.last_name}
            </Text>
            {job.customer.phone && (
              <TouchableOpacity
                style={styles.contactRow}
                onPress={() => Linking.openURL(`tel:${job.customer!.phone}`)}
              >
                <Ionicons name="call-outline" size={16} color="#2ECC71" />
                <Text style={styles.contactText}>{job.customer.phone}</Text>
              </TouchableOpacity>
            )}
            {job.customer.email && (
              <TouchableOpacity
                style={styles.contactRow}
                onPress={() => Linking.openURL(`mailto:${job.customer!.email}`)}
              >
                <Ionicons name="mail-outline" size={16} color="#2ECC71" />
                <Text style={styles.contactText}>{job.customer.email}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Address Card */}
        {addr && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Service Address</Text>
            <Text style={styles.cardValue}>
              {[addr.street, addr.city, addr.state, addr.zip]
                .filter(Boolean)
                .join(', ')}
            </Text>
            <TouchableOpacity style={styles.navigateBtn} onPress={openMaps}>
              <Ionicons name="navigate" size={16} color="#fff" />
              <Text style={styles.navigateBtnText}>Navigate</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Time Window Card */}
        {(job.scheduled_date || job.scheduled_window_start) && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Schedule</Text>
            {job.scheduled_date && (
              <Text style={styles.cardValue}>{job.scheduled_date}</Text>
            )}
            {job.scheduled_window_start && (
              <Text style={styles.cardSubvalue}>
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
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Asset</Text>
            {job.asset.identifier && (
              <Text style={styles.cardValue}>{job.asset.identifier}</Text>
            )}
            {job.asset.subtype && (
              <Text style={styles.cardSubvalue}>{job.asset.subtype}</Text>
            )}
            {job.asset.size && (
              <Text style={styles.cardSubvalue}>Size: {job.asset.size}</Text>
            )}
          </View>
        )}

        {/* Notes */}
        {job.notes && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Notes</Text>
            <Text style={styles.notesText}>{job.notes}</Text>
          </View>
        )}

        {/* Photos Section */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Photos ({photos.length})</Text>
          {photos.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoScroll}>
              {photos.map((p, i) => (
                <View key={i} style={styles.photoThumbWrap}>
                  <Image source={{ uri: p.uri }} style={styles.photoThumb} />
                  <Text style={styles.photoTypeLabel}>{p.type}</Text>
                </View>
              ))}
            </ScrollView>
          )}
          <View style={styles.photoActions}>
            <TouchableOpacity style={styles.photoCameraBtn} onPress={captureFromCamera}>
              <Ionicons name="camera" size={16} color="#fff" />
              <Text style={styles.photoBtnText}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.photoGalleryBtn} onPress={pickFromGallery}>
              <Ionicons name="images" size={16} color="#2ECC71" />
              <Text style={styles.photoGalleryBtnText}>Gallery</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Signature Section */}
        {showSignature && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Signature</Text>
            {job.signature_url ? (
              <Image source={{ uri: job.signature_url }} style={styles.signatureImage} resizeMode="contain" />
            ) : signed ? (
              <View style={styles.signedBanner}>
                <Ionicons name="checkmark-circle" size={18} color="#22C55E" />
                <Text style={styles.signedText}>Signed</Text>
              </View>
            ) : (
              <TouchableOpacity style={styles.signatureBtn} onPress={handleMarkSigned}>
                <Ionicons name="pencil" size={16} color="#fff" />
                <Text style={styles.signatureBtnText}>Capture Signature</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>

      {/* Action Button */}
      {transition && (
        <View style={styles.actionBar}>
          <TouchableOpacity
            style={[styles.actionBtn, updating && styles.actionBtnDisabled]}
            onPress={handleStatusUpdate}
            disabled={updating}
          >
            {updating ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons
                  name={transition.icon as any}
                  size={20}
                  color="#fff"
                />
                <Text style={styles.actionBtnText}>{transition.label}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      {job.status === 'completed' && (
        <View style={styles.actionBar}>
          <View style={styles.completedBanner}>
            <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
            <Text style={styles.completedText}>Job Completed</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B1220' },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0B1220',
  },
  errorText: { fontSize: 16, color: '#EF4444', marginBottom: 12 },
  backLink: { fontSize: 14, color: '#2ECC71' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2D45',
  },
  backBtn: { padding: 4, marginRight: 12 },
  headerContent: { flex: 1 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },
  headerBadges: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  typeText: { fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
  jobNumber: { fontSize: 12, color: '#7A8BA3' },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    backgroundColor: '#111C2E',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1E2D45',
  },
  statusLabel: { fontSize: 13, color: '#7A8BA3' },
  statusValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    textTransform: 'capitalize',
  },
  card: {
    backgroundColor: '#111C2E',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1E2D45',
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#7A8BA3',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  cardValue: { fontSize: 15, fontWeight: '600', color: '#fff' },
  cardSubvalue: { fontSize: 13, color: '#7A8BA3', marginTop: 2 },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  contactText: { fontSize: 14, color: '#2ECC71' },
  navigateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
    backgroundColor: '#2ECC71',
    borderRadius: 10,
    paddingVertical: 10,
  },
  navigateBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  notesText: { fontSize: 14, color: '#fff', lineHeight: 20 },
  // Photos
  photoScroll: { marginBottom: 10 },
  photoThumbWrap: { marginRight: 8, alignItems: 'center' },
  photoThumb: { width: 80, height: 80, borderRadius: 8, backgroundColor: '#1E2D45' },
  photoTypeLabel: { fontSize: 9, color: '#7A8BA3', marginTop: 3, textTransform: 'uppercase' },
  photoActions: { flexDirection: 'row', gap: 8 },
  photoCameraBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#2ECC71',
    borderRadius: 10,
    paddingVertical: 10,
  },
  photoBtnText: { fontSize: 13, fontWeight: '600', color: '#fff' },
  photoGalleryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#111C2E',
    borderRadius: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#1E2D45',
  },
  photoGalleryBtnText: { fontSize: 13, fontWeight: '600', color: '#2ECC71' },
  // Signature
  signatureImage: { width: '100%', height: 120, borderRadius: 8, backgroundColor: '#fff' },
  signatureBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#2ECC71',
    borderRadius: 10,
    paddingVertical: 10,
  },
  signatureBtnText: { fontSize: 13, fontWeight: '600', color: '#fff' },
  signedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(34,197,94,0.1)',
    borderRadius: 10,
    paddingVertical: 10,
  },
  signedText: { fontSize: 14, fontWeight: '600', color: '#22C55E' },
  // Action bar
  actionBar: {
    paddingHorizontal: 20,
    paddingBottom: 36,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1E2D45',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#2ECC71',
    borderRadius: 12,
    paddingVertical: 16,
  },
  actionBtnDisabled: { opacity: 0.6 },
  actionBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  completedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(34,197,94,0.1)',
    borderRadius: 12,
    paddingVertical: 16,
  },
  completedText: { fontSize: 16, fontWeight: '700', color: '#22C55E' },
});
