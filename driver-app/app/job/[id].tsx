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
  Image,
  Modal,
  TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getJobDetail, updateJobStatus, uploadJobPhoto, getDumpLocations, submitDumpSlip, getYards, stageAtYard, failJob, listAssetsForPicker, updateJobAsset } from '../../src/api';
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
  asset_subtype?: string;
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
  asset_id?: string | null;
  asset: { id?: string; identifier?: string; subtype?: string; size?: string } | null;
  notes?: string;
  placement_notes?: string;
  driver_notes?: string;
  route_order: number | null;
  photos?: PhotoEntry[];
  signature_url?: string;
  // Phase 11A — expected on-site asset for pickup/exchange (derived
  // server-side from the rental chain's most recent completed
  // delivery or exchange).
  expected_on_site_asset?: {
    asset_id: string;
    identifier: string;
    subtype: string | null;
    source_job_id: string;
    source_job_number: string;
    source_task_type: string;
  } | null;
}

interface AssetOption {
  id: string;
  identifier: string;
  subtype?: string | null;
  status: string;
  current_location_type?: string | null;
}

const TYPE_COLORS: Record<string, string> = {
  delivery: '#22C55E',
  pickup: '#22C55E',
  exchange: '#22C55E',
};
const TYPE_LABELS: Record<string, string> = {
  delivery: 'Delivery',
  pickup: 'Pickup',
  exchange: 'Exchange',
  dump_run: 'Dump Run',
};

// Simplified 3-step flow: On My Way → Arrived (+ dumpster confirm) → Complete
const STATUS_FLOW: Record<string, { next: string; label: string; icon: string; color: string }> = {
  pending: { next: 'en_route', label: 'On My Way', icon: 'navigate', color: '#22C55E' },
  confirmed: { next: 'en_route', label: 'On My Way', icon: 'navigate', color: '#22C55E' },
  dispatched: { next: 'en_route', label: 'On My Way', icon: 'navigate', color: '#22C55E' },
  en_route: { next: 'arrived', label: 'Arrived', icon: 'location', color: '#22C55E' },
  arrived: { next: 'completed', label: 'Complete Job', icon: 'checkmark-done', color: '#22C55E' },
  in_progress: { next: 'completed', label: 'Complete Job', icon: 'checkmark-done', color: '#22C55E' },
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
  const [dumpsterConfirmed, setDumpsterConfirmed] = useState(false);
  // Phase 11A — asset picker state (replaces the old pin prompt).
  // Server-authoritative: saving the selection calls
  // `PATCH /jobs/:id/asset` so the backend conflict guard + audit
  // trail run even on the driver side.
  const [assetOptions, setAssetOptions] = useState<AssetOption[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [assetSearch, setAssetSearch] = useState('');
  const [savingAsset, setSavingAsset] = useState(false);
  const [assetConflict, setAssetConflict] = useState<string | null>(null);
  const [assetOverrideAck, setAssetOverrideAck] = useState(false);
  const [showWhereNext, setShowWhereNext] = useState(false);
  const [yards, setYards] = useState<Array<{ id: string; name: string; is_primary: boolean }>>([]);
  const [showYardPicker, setShowYardPicker] = useState(false);
  const [selectedYardId, setSelectedYardId] = useState<string>('');
  const [stagingAtYard, setStagingAtYard] = useState(false);

  // Complete Stop modal state
  const [showCompleteStop, setShowCompleteStop] = useState(false);
  const [csPhoto, setCsPhoto] = useState<{ uri: string; base64: string } | null>(null);
  const [csTicketNumber, setCsTicketNumber] = useState('');
  const [csNetWeight, setCsNetWeight] = useState('');
  const [csDumpLocations, setCsDumpLocations] = useState<any[]>([]);
  const [csSelectedLocation, setCsSelectedLocation] = useState<string>('');
  const [csShowLocationPicker, setCsShowLocationPicker] = useState(false);
  const [csSubmitting, setCsSubmitting] = useState(false);
  const [csShowNoPhotoWarning, setCsShowNoPhotoWarning] = useState(false);

  // Failed Trip modal state
  const [showFailModal, setShowFailModal] = useState(false);
  const [failReason, setFailReason] = useState('');
  const [failNotes, setFailNotes] = useState('');
  const [failPhoto, setFailPhoto] = useState<{ uri: string; base64: string } | null>(null);
  const [failSubmitting, setFailSubmitting] = useState(false);

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

    // For "Complete Job" on arrived status — require asset confirmation first
    if ((job.status === 'arrived' || job.status === 'in_progress') && !dumpsterConfirmed) {
      await openAssetPicker();
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

      // Step 2 complete: open asset picker
      if (newStatus === 'arrived') {
        await openAssetPicker();
      }

      // Step 3 complete: post-completion routing
      if (newStatus === 'completed') {
        if (job.job_type === 'pickup' || job.job_type === 'exchange') {
          setShowWhereNext(true);
        } else {
          Alert.alert('Job Complete', 'Job has been completed.', [
            { text: 'OK', onPress: () => router.replace('/(tabs)' as any) },
          ]);
        }
      }
    } catch (err) {
      Alert.alert('Error', (err as any)?.response?.data?.message || (err as any)?.message || 'Failed to update status');
    } finally {
      setUpdating(false);
    }
  };

  // Phase 11A — open the asset picker. Fetches tenant assets of the
  // same subtype (falls back to all if the job has no subtype hint),
  // pre-selects the currently-assigned or expected-on-site asset so
  // the common case is a one-tap confirmation.
  const openAssetPicker = useCallback(async () => {
    if (!job) return;
    setShowDumpsterModal(true);
    setLoadingAssets(true);
    setAssetConflict(null);
    setAssetOverrideAck(false);
    setAssetSearch('');

    // Default selection: current asset_id → expected asset → none
    const defaultSelection =
      job.asset_id ||
      job.asset?.id ||
      job.expected_on_site_asset?.asset_id ||
      null;
    setSelectedAssetId(defaultSelection);

    try {
      const subtype = job.asset_subtype || job.asset?.subtype || undefined;
      const list = await listAssetsForPicker(subtype);
      // Available first, then in-use, excluding retired
      const usable = (Array.isArray(list) ? list : []).filter(
        (a: any) => a.status !== 'retired',
      );
      usable.sort((a: any, b: any) => {
        const av = a.status === 'available' ? 0 : 1;
        const bv = b.status === 'available' ? 0 : 1;
        if (av !== bv) return av - bv;
        return (a.identifier || '').localeCompare(b.identifier || '');
      });
      setAssetOptions(usable);
    } catch {
      setAssetOptions([]);
    } finally {
      setLoadingAssets(false);
    }
  }, [job]);

  // Phase 11A — save the picker selection. Calls the authoritative
  // `PATCH /jobs/:id/asset` endpoint so the backend conflict guard
  // and audit trail run even from the driver side. On conflict, the
  // UI re-opens with an override warning; a second tap submits with
  // `override=true` and the backend records it in the audit trail.
  const handleAssetSave = async () => {
    if (!job || !selectedAssetId) {
      Alert.alert('Required', 'Pick a dumpster before continuing');
      return;
    }
    setSavingAsset(true);
    setAssetConflict(null);
    try {
      await updateJobAsset(job.id, selectedAssetId, {
        override: assetOverrideAck,
      });
      // Mirror the new asset locally so the header + complete-button
      // flip without waiting for a full job refetch.
      const picked = assetOptions.find((a) => a.id === selectedAssetId);
      setJob((prev) =>
        prev
          ? {
              ...prev,
              asset_id: selectedAssetId,
              asset: picked
                ? {
                    id: picked.id,
                    identifier: picked.identifier,
                    subtype: picked.subtype || undefined,
                  }
                : prev.asset,
            }
          : prev,
      );
      setDumpsterConfirmed(true);
      setShowDumpsterModal(false);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        'Failed to save asset';
      // Backend signals active-job conflict via the sentinel prefix
      if (typeof msg === 'string' && msg.includes('asset_active_conflict')) {
        setAssetConflict(msg.replace(/^asset_active_conflict:\s*/, ''));
        setAssetOverrideAck(false);
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setSavingAsset(false);
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

  // Complete Stop: open modal and load dump locations + last used
  const openCompleteStop = useCallback(async () => {
    setCsPhoto(null);
    setCsTicketNumber('');
    setCsNetWeight('');
    setCsShowNoPhotoWarning(false);
    setShowCompleteStop(true);

    try {
      const locations = await getDumpLocations();
      setCsDumpLocations(locations);
      const lastId = await AsyncStorage.getItem('lastDumpLocation');
      if (lastId && locations.some((l: any) => l.id === lastId)) {
        setCsSelectedLocation(lastId);
      } else if (locations.length > 0) {
        setCsSelectedLocation(locations[0].id);
      }
    } catch {
      /* locations optional */
    }
  }, []);

  // Complete Stop: take photo
  const csCapture = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission required', 'Camera access is needed to take photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.7 });
    if (!result.canceled && result.assets?.[0]) {
      setCsPhoto({ uri: result.assets[0].uri, base64: result.assets[0].base64 || '' });
      setCsShowNoPhotoWarning(false);
    }
  };

  // Complete Stop: submit
  const csComplete = async (bypassPhotoWarning = false) => {
    if (!job) return;
    const needsDumpFields = job.job_type === 'pickup' || job.job_type === 'exchange';

    // Soft warning: no photo on pickup/exchange
    if (needsDumpFields && !csPhoto && !bypassPhotoWarning) {
      setCsShowNoPhotoWarning(true);
      return;
    }

    setCsSubmitting(true);
    try {
      // 1) Upload photo if taken
      if (csPhoto) {
        await uploadJobPhoto(job.id, csPhoto.base64, 'After');
        const newPhotoEntry: PhotoEntry = { uri: csPhoto.uri, takenAt: new Date().toISOString(), type: 'After' };
        setPhotos((prev) => [...prev, newPhotoEntry]);
      }

      // 2) Submit dump slip for pickup/exchange if fields filled
      if (needsDumpFields && (csTicketNumber || csNetWeight)) {
        await submitDumpSlip(job.id, {
          dumpLocationId: csSelectedLocation,
          ticketNumber: csTicketNumber,
          wasteType: 'cnd',
          weightTons: parseFloat(csNetWeight) || 0,
        });
      }

      // 3) Complete the job
      await updateJobStatus(job.id, 'completed');
      setJob((prev) => (prev ? { ...prev, status: 'completed' } : prev));

      // 4) Save last dump location
      if (csSelectedLocation) {
        await AsyncStorage.setItem('lastDumpLocation', csSelectedLocation);
      }

      // 5) Success
      setShowCompleteStop(false);
      Alert.alert('Job Complete', 'Job has been completed.', [
        { text: 'OK', onPress: () => router.replace('/(tabs)' as any) },
      ]);
    } catch (err) {
      Alert.alert('Error', (err as any)?.response?.data?.message || (err as any)?.message || 'Failed to complete job');
    } finally {
      setCsSubmitting(false);
    }
  };

  // Failed Trip: take photo
  const failCapture = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission required', 'Camera access is needed to take photos.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.7 });
    if (!result.canceled && result.assets?.[0]) {
      setFailPhoto({ uri: result.assets[0].uri, base64: result.assets[0].base64 || '' });
    }
  };

  // Failed Trip: submit
  const handleFailSubmit = async () => {
    if (!job || !failReason) return;
    setFailSubmitting(true);
    try {
      // Upload photo if taken
      if (failPhoto) {
        await uploadJobPhoto(job.id, failPhoto.base64, 'Damage');
      }
      // Call fail endpoint
      await failJob(job.id, `${failReason}${failNotes ? ': ' + failNotes : ''}`);
      setShowFailModal(false);
      Alert.alert('Stop Reported', 'Failed trip recorded. A replacement job will be created.', [
        { text: 'OK', onPress: () => router.replace('/(tabs)' as any) },
      ]);
    } catch (err) {
      Alert.alert('Error', (err as any)?.message || 'Failed to report');
    } finally {
      setFailSubmitting(false);
    }
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

      {/* Priority Header — Size, Type, Address */}
      {(() => {
        const subtypeRaw = job.asset_subtype || job.asset?.subtype;
        const sizeLabel = subtypeRaw
          ? subtypeRaw.replace(/[^0-9]/g, '') + ' YARD'
          : null;
        const typeColor = TYPE_COLORS[job.job_type] || '#71717A';
        const fullAddr = addr
          ? [addr.street, addr.city, addr.state].filter(Boolean).join(', ')
          : null;
        return (
          <View style={{
            paddingHorizontal: 20,
            paddingVertical: 14,
            borderLeftWidth: 5,
            borderLeftColor: typeColor,
            marginHorizontal: 16,
            marginTop: 8,
            marginBottom: 4,
            backgroundColor: colors.surface,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
          }}>
            <Text style={{ fontSize: 24, fontWeight: '900', color: colors.text, letterSpacing: -0.5 }}>
              {sizeLabel || TYPE_LABELS[job.job_type] || job.job_type.toUpperCase()}
              {sizeLabel ? (
                <Text style={{ color: typeColor }}>{' — '}{(TYPE_LABELS[job.job_type] || job.job_type).toUpperCase()}</Text>
              ) : null}
            </Text>
            {fullAddr && (
              <Text style={{ fontSize: 15, color: colors.textSecondary, marginTop: 4 }}>
                {fullAddr}
              </Text>
            )}
          </View>
        );
      })()}

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
            {(job.asset_subtype || job.asset?.subtype) ? (job.asset_subtype || job.asset?.subtype || '').replace('yd', ' Yard') + ' Dumpster' : (TYPE_LABELS[job.job_type] || job.job_type)}
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

        {/* Notes Card */}
        {(job.placement_notes || job.notes || job.driver_notes) && (
          <View style={[s.card, { backgroundColor: '#FFFBEB', borderLeftWidth: 4, borderLeftColor: '#F59E0B' }]}>
            <Text style={{ fontSize: 11, fontWeight: '800', color: '#92400E', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>NOTES</Text>
            {job.placement_notes ? (
              <View style={{ marginBottom: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#92400E', marginBottom: 2 }}>Placement</Text>
                <Text style={{ fontSize: 14, color: '#0A0A0A' }}>{job.placement_notes}</Text>
              </View>
            ) : null}
            {job.notes ? (
              <View style={{ marginBottom: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#92400E', marginBottom: 2 }}>Dispatcher</Text>
                <Text style={{ fontSize: 14, color: '#0A0A0A' }}>{job.notes}</Text>
              </View>
            ) : null}
            {job.driver_notes ? (
              <View>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#92400E', marginBottom: 2 }}>Your Notes</Text>
                <Text style={{ fontSize: 14, color: '#0A0A0A' }}>{job.driver_notes}</Text>
              </View>
            ) : null}
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
          {/* Complete Stop shortcut — shown above the main action when dumpster is confirmed */}
          {(job.status === 'arrived' || job.status === 'in_progress') && dumpsterConfirmed && (
            <TouchableOpacity
              style={[s.actionBtn, { backgroundColor: '#F59E0B', marginBottom: 10 }]}
              onPress={openCompleteStop}
            >
              <Ionicons name="clipboard" size={20} color="#fff" />
              <Text style={s.actionBtnText}>Complete Stop</Text>
            </TouchableOpacity>
          )}
          {/* Show "Complete Job" only after dumpster confirmed on arrived status */}
          {(job.status === 'arrived' || job.status === 'in_progress') && !dumpsterConfirmed ? (
            <TouchableOpacity
              style={[s.actionBtn, { backgroundColor: '#22C55E' }]}
              onPress={openAssetPicker}
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
          {transition && job.status !== 'completed' && job.status !== 'cancelled' && (
            <TouchableOpacity onPress={() => { setFailReason(''); setFailNotes(''); setFailPhoto(null); setShowFailModal(true); }} style={{ alignItems: 'center', paddingTop: 8 }}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: colors.error }}>Can't Complete</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {job.status === 'completed' && (
        <View style={s.actionBar}>
          <TouchableOpacity style={s.completedBanner} onPress={() => router.replace('/(tabs)' as any)}>
            <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
            <Text style={s.completedText}>Job Completed</Text>
            <Text style={{ fontSize: 12, color: '#8A8A8A', marginLeft: 'auto' }}>Back to Route</Text>
          </TouchableOpacity>
          {(job.job_type === 'pickup' || job.job_type === 'exchange') && (
            <TouchableOpacity
              style={[s.actionBtn, { marginTop: 10, backgroundColor: '#22C55E' }]}
              onPress={() => router.push({ pathname: '/job/dump-slip', params: { jobId: job.id, customerName: `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim() } })}
            >
              <Ionicons name="document-text" size={20} color="#fff" />
              <Text style={s.actionBtnText}>Enter Dump Slip</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Dumpster / Asset Picker Modal — Phase 11A */}
      <Modal visible={showDumpsterModal} transparent animationType="slide">
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, maxHeight: '85%' }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 4 }}>
              {job.job_type === 'delivery' ? 'Confirm Drop-Off' : job.job_type === 'exchange' ? 'Confirm Exchange' : 'Confirm Pickup'}
            </Text>
            <Text style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 12 }}>
              Pick the dumpster on this job. Required to complete.
            </Text>

            {/* Expected on-site hint for pickup/exchange */}
            {job.expected_on_site_asset && (
              <View style={{ backgroundColor: colors.accentSoft, borderRadius: 12, padding: 10, marginBottom: 12 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: colors.accent, marginBottom: 2 }}>
                  EXPECTED ON-SITE
                </Text>
                <Text style={{ fontSize: 13, color: colors.text }}>
                  {job.expected_on_site_asset.identifier}
                  {job.expected_on_site_asset.subtype ? ` (${job.expected_on_site_asset.subtype})` : ''}
                </Text>
              </View>
            )}

            {/* Search */}
            <TextInput
              value={assetSearch}
              onChangeText={setAssetSearch}
              placeholder="Search by identifier…"
              placeholderTextColor={colors.textSecondary}
              style={{
                backgroundColor: colors.surfaceHover,
                borderRadius: 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
                fontSize: 15,
                color: colors.text,
                borderWidth: 1,
                borderColor: colors.border,
                marginBottom: 12,
              }}
            />

            {/* Asset list */}
            <ScrollView style={{ maxHeight: 320 }}>
              {loadingAssets ? (
                <View style={{ paddingVertical: 32, alignItems: 'center' }}>
                  <ActivityIndicator color={colors.accent} />
                </View>
              ) : assetOptions.length === 0 ? (
                <View style={{ paddingVertical: 32, alignItems: 'center' }}>
                  <Text style={{ color: colors.textSecondary, fontSize: 13 }}>
                    No assets available
                  </Text>
                </View>
              ) : (
                assetOptions
                  .filter((a) =>
                    assetSearch
                      ? (a.identifier || '')
                          .toLowerCase()
                          .includes(assetSearch.toLowerCase())
                      : true,
                  )
                  .map((a) => {
                    const isSelected = selectedAssetId === a.id;
                    const isInUse = a.status !== 'available';
                    return (
                      <TouchableOpacity
                        key={a.id}
                        onPress={() => {
                          setSelectedAssetId(a.id);
                          setAssetConflict(null);
                          setAssetOverrideAck(false);
                        }}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          backgroundColor: isSelected ? colors.accentSoft : colors.surfaceHover,
                          borderRadius: 12,
                          padding: 12,
                          marginBottom: 8,
                          borderWidth: 1,
                          borderColor: isSelected ? colors.accent : colors.border,
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>
                            {a.identifier}
                            {a.subtype ? (
                              <Text style={{ fontSize: 13, fontWeight: '500', color: colors.textSecondary }}>
                                {'  '}
                                {a.subtype}
                              </Text>
                            ) : null}
                          </Text>
                        </View>
                        <View
                          style={{
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                            borderRadius: 6,
                            backgroundColor: isInUse ? '#F59E0B22' : '#22C55E22',
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 10,
                              fontWeight: '700',
                              color: isInUse ? '#F59E0B' : '#22C55E',
                              textTransform: 'uppercase',
                            }}
                          >
                            {isInUse ? 'In Use' : 'Available'}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })
              )}
            </ScrollView>

            {/* Conflict warning */}
            {assetConflict && (
              <View
                style={{
                  backgroundColor: '#F59E0B22',
                  borderRadius: 12,
                  padding: 12,
                  marginTop: 12,
                  borderWidth: 1,
                  borderColor: '#F59E0B',
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#F59E0B', marginBottom: 4 }}>
                  ASSET CONFLICT
                </Text>
                <Text style={{ fontSize: 13, color: colors.text, marginBottom: 8 }}>
                  {assetConflict}
                </Text>
                <TouchableOpacity
                  onPress={() => setAssetOverrideAck(true)}
                  style={{
                    backgroundColor: assetOverrideAck ? '#F59E0B' : 'transparent',
                    borderWidth: 1,
                    borderColor: '#F59E0B',
                    borderRadius: 10,
                    paddingVertical: 8,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: assetOverrideAck ? '#000' : '#F59E0B' }}>
                    {assetOverrideAck ? 'Override Ready — tap Confirm' : 'Override & Continue'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <TouchableOpacity
                onPress={() => setShowDumpsterModal(false)}
                disabled={savingAsset}
                style={{
                  flex: 1,
                  paddingVertical: 16,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: colors.border,
                  alignItems: 'center',
                  opacity: savingAsset ? 0.5 : 1,
                }}
              >
                <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleAssetSave}
                disabled={!selectedAssetId || savingAsset || (assetConflict && !assetOverrideAck) ? true : false}
                style={{
                  flex: 1,
                  paddingVertical: 16,
                  borderRadius: 20,
                  backgroundColor: colors.accent,
                  alignItems: 'center',
                  opacity:
                    !selectedAssetId || savingAsset || (assetConflict && !assetOverrideAck)
                      ? 0.5
                      : 1,
                }}
              >
                {savingAsset ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={{ fontSize: 15, fontWeight: '700', color: '#000' }}>Confirm</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Where to Next? */}
      <Modal visible={showWhereNext} transparent animationType="slide">
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 }}>
            {showYardPicker ? (
              <>
                <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 12 }}>Select Yard</Text>
                {yards.map(y => (
                  <TouchableOpacity key={y.id} onPress={() => setSelectedYardId(y.id)}
                    style={{
                      backgroundColor: selectedYardId === y.id ? colors.accentSoft : colors.surfaceHover,
                      borderRadius: 14, padding: 16, marginBottom: 8,
                      borderWidth: selectedYardId === y.id ? 2 : 1,
                      borderColor: selectedYardId === y.id ? colors.accent : colors.border,
                    }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{y.name}</Text>
                    {y.is_primary && <Text style={{ fontSize: 11, color: colors.accent, marginTop: 2 }}>Primary Yard</Text>}
                  </TouchableOpacity>
                ))}
                <TouchableOpacity onPress={async () => {
                  setStagingAtYard(true);
                  try {
                    await stageAtYard(job.id, { yardId: selectedYardId });
                    setShowYardPicker(false);
                    setShowWhereNext(false);
                    router.replace('/(tabs)' as any);
                  } catch { Alert.alert('Error', 'Failed to stage at yard'); }
                  finally { setStagingAtYard(false); }
                }} disabled={stagingAtYard}
                  style={{ backgroundColor: colors.accent, borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8, opacity: stagingAtYard ? 0.5 : 1 }}>
                  {stagingAtYard ? <ActivityIndicator color="#fff" /> : <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>Drop at Yard</Text>}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={{ fontSize: 20, fontWeight: '800', color: '#0A0A0A', marginBottom: 20 }}>Where to next?</Text>
                <TouchableOpacity onPress={() => {
                  setShowWhereNext(false);
                  router.push({ pathname: '/job/dump-slip', params: { jobId: job.id, customerName: `${job.customer?.first_name || ''} ${job.customer?.last_name || ''}`.trim() } });
                }} style={{ backgroundColor: '#22C55E', borderRadius: 14, padding: 16, marginBottom: 10, alignItems: 'center' }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>Go to Dump</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={async () => {
                  try {
                    const yardList = await getYards();
                    if (yardList.length <= 1) {
                      setStagingAtYard(true);
                      await stageAtYard(job.id, { yardId: yardList[0]?.id });
                      setStagingAtYard(false);
                      setShowWhereNext(false);
                      router.replace('/(tabs)' as any);
                    } else {
                      setYards(yardList);
                      setSelectedYardId(yardList.find((y: any) => y.is_primary)?.id || yardList[0]?.id || '');
                      setShowYardPicker(true);
                    }
                  } catch {
                    setShowWhereNext(false);
                    router.replace('/(tabs)' as any);
                  }
                }}
                  style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 14, padding: 16, marginBottom: 10, alignItems: 'center' }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#0A0A0A' }}>Return to Yard</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setShowWhereNext(false); router.replace('/(tabs)' as any); }}
                  style={{ alignItems: 'center', paddingVertical: 12 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#8A8A8A' }}>Skip — Next Job</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Failed Trip Modal */}
      <Modal visible={showFailModal} transparent animationType="slide">
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, maxHeight: '85%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>Report Failed Stop</Text>
              <TouchableOpacity onPress={() => setShowFailModal(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Reason picker */}
              <Text style={{ fontSize: 11, fontWeight: '800', color: colors.textSecondary, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>REASON</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {['Blocked', 'Customer Not Ready', 'Overfilled', 'Inaccessible', 'No Access', 'Unsafe Conditions', 'Wrong Size', 'Other'].map((r) => (
                  <TouchableOpacity
                    key={r}
                    onPress={() => setFailReason(r)}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      borderRadius: 10,
                      borderWidth: failReason === r ? 2 : 1,
                      borderColor: failReason === r ? colors.error : colors.border,
                      backgroundColor: failReason === r ? (colors.error + '14') : colors.surfaceHover,
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: failReason === r ? '700' : '500', color: failReason === r ? colors.error : colors.text }}>{r}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Notes */}
              <Text style={{ fontSize: 11, fontWeight: '800', color: colors.textSecondary, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6 }}>NOTES (OPTIONAL)</Text>
              <TextInput
                style={{
                  backgroundColor: colors.surfaceHover,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: colors.border,
                  padding: 12,
                  fontSize: 14,
                  color: colors.text,
                  minHeight: 70,
                  textAlignVertical: 'top',
                  marginBottom: 16,
                }}
                value={failNotes}
                onChangeText={setFailNotes}
                placeholder="Additional details..."
                placeholderTextColor={colors.textTertiary}
                multiline
              />

              {/* Photo capture */}
              <TouchableOpacity
                onPress={failCapture}
                style={{
                  backgroundColor: colors.surfaceHover,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderStyle: 'dashed',
                  height: 120,
                  justifyContent: 'center',
                  alignItems: 'center',
                  marginBottom: 16,
                  overflow: 'hidden',
                }}
              >
                {failPhoto ? (
                  <Image source={{ uri: failPhoto.uri }} style={{ width: '100%', height: '100%', borderRadius: 14 }} resizeMode="cover" />
                ) : (
                  <View style={{ alignItems: 'center' }}>
                    <Ionicons name="camera" size={28} color={colors.textTertiary} />
                    <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 4 }}>Tap to take photo (optional)</Text>
                  </View>
                )}
              </TouchableOpacity>
              {failPhoto && (
                <Text style={{ fontSize: 12, color: colors.textSecondary, textAlign: 'center', marginTop: -12, marginBottom: 12 }}>Tap photo to retake</Text>
              )}
            </ScrollView>

            {/* Submit button */}
            <TouchableOpacity
              onPress={handleFailSubmit}
              disabled={failSubmitting || !failReason}
              style={{
                backgroundColor: !failReason ? '#ccc' : '#DC2626',
                borderRadius: 28,
                paddingVertical: 16,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 8,
                marginTop: 12,
                opacity: failSubmitting ? 0.6 : 1,
              }}
            >
              {failSubmitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="warning" size={20} color="#fff" />
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>Submit Failed Trip</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Complete Stop Modal */}
      <Modal visible={showCompleteStop} transparent animationType="slide">
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, maxHeight: '85%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>Complete Stop</Text>
              <TouchableOpacity onPress={() => setShowCompleteStop(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Camera capture area */}
              <TouchableOpacity
                onPress={csCapture}
                style={{
                  backgroundColor: colors.surfaceHover,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderStyle: 'dashed',
                  height: 140,
                  justifyContent: 'center',
                  alignItems: 'center',
                  marginBottom: 16,
                  overflow: 'hidden',
                }}
              >
                {csPhoto ? (
                  <Image source={{ uri: csPhoto.uri }} style={{ width: '100%', height: '100%', borderRadius: 14 }} resizeMode="cover" />
                ) : (
                  <View style={{ alignItems: 'center' }}>
                    <Ionicons name="camera" size={32} color={colors.textTertiary} />
                    <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 6 }}>Tap to take photo</Text>
                  </View>
                )}
              </TouchableOpacity>
              {csPhoto && (
                <Text style={{ fontSize: 12, color: colors.textSecondary, textAlign: 'center', marginTop: -12, marginBottom: 12 }}>Tap photo to retake</Text>
              )}

              {/* Dump ticket fields — only for pickup/exchange */}
              {(job.job_type === 'pickup' || job.job_type === 'exchange') && (
                <View style={{ marginBottom: 8 }}>
                  <Text style={{ fontSize: 11, fontWeight: '800', color: colors.textSecondary, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>DUMP TICKET</Text>

                  {/* Ticket number */}
                  <View style={{ marginBottom: 12 }}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 4 }}>Ticket Number</Text>
                    <TextInput
                      style={{
                        backgroundColor: colors.surfaceHover,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: colors.border,
                        padding: 12,
                        fontSize: 15,
                        color: colors.text,
                      }}
                      value={csTicketNumber}
                      onChangeText={setCsTicketNumber}
                      placeholder="Enter ticket #"
                      placeholderTextColor={colors.textTertiary}
                      autoFocus
                    />
                    {job.job_type === 'pickup' && !csTicketNumber && (
                      <Text style={{ fontSize: 11, color: '#F59E0B', marginTop: 4 }}>Ticket number recommended for pickup jobs</Text>
                    )}
                  </View>

                  {/* Net weight */}
                  <View style={{ marginBottom: 12 }}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 4 }}>Net Weight (tons)</Text>
                    <TextInput
                      style={{
                        backgroundColor: colors.surfaceHover,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: colors.border,
                        padding: 12,
                        fontSize: 15,
                        color: colors.text,
                      }}
                      value={csNetWeight}
                      onChangeText={setCsNetWeight}
                      placeholder="0.00"
                      placeholderTextColor={colors.textTertiary}
                      keyboardType="decimal-pad"
                    />
                    {parseFloat(csNetWeight) > 10 && (
                      <Text style={{ fontSize: 11, color: '#F59E0B', marginTop: 4 }}>Weight seems high — please verify.</Text>
                    )}
                  </View>

                  {/* Dump location dropdown */}
                  <View style={{ marginBottom: 12 }}>
                    <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 4 }}>Dump Location</Text>
                    <TouchableOpacity
                      onPress={() => setCsShowLocationPicker(!csShowLocationPicker)}
                      style={{
                        backgroundColor: colors.surfaceHover,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: colors.border,
                        padding: 12,
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ fontSize: 15, color: csSelectedLocation ? colors.text : colors.textTertiary }}>
                        {csSelectedLocation
                          ? (csDumpLocations.find((l: any) => l.id === csSelectedLocation)?.name || 'Selected')
                          : 'Select location'}
                      </Text>
                      <Ionicons name={csShowLocationPicker ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
                    </TouchableOpacity>
                    {csShowLocationPicker && (
                      <View style={{ backgroundColor: colors.surfaceHover, borderRadius: 10, borderWidth: 1, borderColor: colors.border, marginTop: 4, maxHeight: 150 }}>
                        <ScrollView nestedScrollEnabled>
                          {csDumpLocations.map((loc: any) => (
                            <TouchableOpacity
                              key={loc.id}
                              onPress={() => { setCsSelectedLocation(loc.id); setCsShowLocationPicker(false); }}
                              style={{
                                padding: 12,
                                borderBottomWidth: 0.5,
                                borderBottomColor: colors.borderSubtle,
                                backgroundColor: loc.id === csSelectedLocation ? colors.accentSoft : 'transparent',
                              }}
                            >
                              <Text style={{ fontSize: 14, color: colors.text, fontWeight: loc.id === csSelectedLocation ? '700' : '400' }}>{loc.name}</Text>
                              {loc.address && <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>{loc.address}</Text>}
                            </TouchableOpacity>
                          ))}
                          {csDumpLocations.length === 0 && (
                            <Text style={{ padding: 12, fontSize: 13, color: colors.textTertiary }}>No locations available</Text>
                          )}
                        </ScrollView>
                      </View>
                    )}
                  </View>
                </View>
              )}

              {/* No-photo warning banner */}
              {csShowNoPhotoWarning && (
                <View style={{ backgroundColor: '#FFFBEB', borderRadius: 10, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#F59E0B' }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#92400E', marginBottom: 10 }}>No photo attached — are you sure?</Text>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity
                      onPress={() => { setCsShowNoPhotoWarning(false); csCapture(); }}
                      style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#F59E0B', alignItems: 'center' }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>Add Photo</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => csComplete(true)}
                      style={{ flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#F59E0B', alignItems: 'center' }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#92400E' }}>Complete Anyway</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </ScrollView>

            {/* Complete button */}
            <TouchableOpacity
              onPress={() => csComplete(false)}
              disabled={csSubmitting}
              style={{
                backgroundColor: '#22C55E',
                borderRadius: 28,
                paddingVertical: 16,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 8,
                marginTop: 12,
                opacity: csSubmitting ? 0.6 : 1,
              }}
            >
              {csSubmitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle" size={20} color="#fff" />
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>Complete</Text>
                </>
              )}
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
