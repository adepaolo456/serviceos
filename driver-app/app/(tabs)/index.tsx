import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Platform,
  Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useAuth } from '../../src/AuthContext';
import { getDriverJobs } from '../../src/api';
import { useAppTheme, type ThemeColors } from '../../constants/theme';

interface Job {
  id: string;
  job_number: string;
  job_type: string;
  service_type: string;
  status: string;
  priority: string;
  scheduled_window_start: string;
  scheduled_window_end: string;
  service_address: { street?: string; city?: string; state?: string } | null;
  route_order: number | null;
  customer: { first_name: string; last_name: string } | null;
  asset: { identifier?: string; subtype?: string } | null;
  is_overdue?: boolean;
  extra_days?: number;
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
const STATUS_COLORS: Record<string, string> = {
  pending: '#71717A',
  confirmed: '#3B82F6',
  dispatched: '#8B5CF6',
  en_route: '#EAB308',
  arrived: '#06B6D4',
  in_progress: '#F97316',
  completed: '#22C55E',
  cancelled: '#F87171',
};

function fmtTime(t: string | null) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hr = parseInt(h);
  return `${hr === 0 ? 12 : hr > 12 ? hr - 12 : hr}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
}

export default function TodayScreen() {
  const { user, isClockedIn, doClockIn, doClockOut } = useAuth();
  const router = useRouter();
  const colors = useAppTheme();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const today = format(new Date(), 'yyyy-MM-dd');

  const fetchJobs = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await getDriverJobs(user.id, today, today);
      const sorted = (Array.isArray(data) ? data : []).sort(
        (a: Job, b: Job) => (a.route_order || 99) - (b.route_order || 99)
      );
      setJobs(sorted);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [user, today]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const completed = jobs.filter((j) => j.status === 'completed').length;
  const s = makeStyles(colors);

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Today's Route</Text>
        <Text style={s.headerDate}>{format(new Date(), 'EEEE, MMMM d')}</Text>
        <TouchableOpacity
          onPress={async () => {
            try {
              if (isClockedIn) await doClockOut();
              else await doClockIn();
            } catch {}
          }}
          style={{
            backgroundColor: isClockedIn ? colors.errorSoft : colors.accentSoft,
            paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
            alignSelf: 'flex-start', marginTop: 8,
          }}>
          <Text style={{ color: isClockedIn ? colors.error : colors.accent, fontSize: 13, fontWeight: '700' }}>
            {isClockedIn ? '⏹ Clock Out' : '▶ Clock In'}
          </Text>
        </TouchableOpacity>
      </View>

      {jobs.length > 0 && (
        <View style={s.progressCard}>
          <View style={s.progressRow}>
            <Text style={s.progressText}>
              {completed} of {jobs.length} stops
            </Text>
            <Text style={s.progressPercent}>
              {Math.round((completed / jobs.length) * 100)}%
            </Text>
          </View>
          <View style={s.progressBar}>
            <View
              style={[
                s.progressFill,
                { width: `${(completed / jobs.length) * 100}%` },
              ]}
            />
          </View>
        </View>
      )}

      <FlatList
        data={jobs}
        keyExtractor={(j) => j.id}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={fetchJobs} tintColor={colors.accent} />
        }
        contentContainerStyle={jobs.length === 0 ? s.emptyContainer : s.list}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="sunny" size={48} color={colors.textTertiary} />
            <Text style={s.emptyTitle}>No jobs today</Text>
            <Text style={s.emptyText}>Enjoy your day off!</Text>
          </View>
        }
        renderItem={({ item: j, index }) => {
          const isCompleted = j.status === 'completed';
          const isNextStop = !isCompleted && jobs.findIndex(j => j.status !== 'completed' && j.status !== 'cancelled') === index;
          const addr = j.service_address;
          return (
            <TouchableOpacity
              style={[
                s.card,
                isNextStop && s.cardNextStop,
                isCompleted && s.cardCompleted,
              ]}
              onPress={() => router.push(`/job/${j.id}`)}
              activeOpacity={0.7}
            >
              {isNextStop && <View style={s.cardGreenEdge} />}
              <View style={s.cardRow}>
                <View style={[s.stopCircle, isCompleted && s.stopCircleDone]}>
                  {isCompleted ? (
                    <Ionicons name="checkmark" size={14} color="#fff" />
                  ) : (
                    <Text style={s.stopNum}>{index + 1}</Text>
                  )}
                </View>
                <View style={s.cardContent}>
                  <View style={s.cardTop}>
                    <Text
                      style={[s.customerName, isCompleted && s.textFaded]}
                      numberOfLines={1}
                    >
                      {j.customer
                        ? `${j.customer.first_name} ${j.customer.last_name}`
                        : j.job_number}
                    </Text>
                    <View
                      style={[
                        s.typeBadge,
                        {
                          backgroundColor:
                            (TYPE_COLORS[j.job_type] || '#71717A') + '14',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          s.typeText,
                          { color: TYPE_COLORS[j.job_type] || '#71717A' },
                        ]}
                      >
                        {TYPE_LABELS[j.job_type] || j.job_type}
                      </Text>
                    </View>
                  </View>
                  {addr && (
                    <Text
                      style={[s.address, isCompleted && s.textFaded]}
                      numberOfLines={1}
                    >
                      {[addr.street, addr.city].filter(Boolean).join(', ')}
                    </Text>
                  )}
                  <View style={s.cardMeta}>
                    {j.asset?.identifier && <View style={s.sizeBadge}><Text style={s.sizeBadgeText}>{j.asset.identifier}</Text></View>}
                    {j.scheduled_window_start && (
                      <Text style={s.metaText}>
                        {fmtTime(j.scheduled_window_start)}
                        {j.scheduled_window_end
                          ? ` - ${fmtTime(j.scheduled_window_end)}`
                          : ''}
                      </Text>
                    )}
                    {j.is_overdue && (
                      <Text style={s.overdueBadge}>OVERDUE {j.extra_days}d</Text>
                    )}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12 },
    headerTitle: { fontSize: 28, fontWeight: '700', color: colors.text, letterSpacing: -0.5 },
    headerDate: { fontSize: 14, color: colors.textSecondary, marginTop: 2 },
    progressCard: {
      marginHorizontal: 20,
      marginBottom: 12,
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
    },
    progressRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 10,
    },
    progressText: { fontSize: 13, fontWeight: '600', color: colors.text },
    progressPercent: { fontSize: 13, fontWeight: '700', color: colors.accent },
    progressBar: {
      height: 3,
      backgroundColor: colors.border,
      borderRadius: 1.5,
      overflow: 'hidden',
    },
    progressFill: { height: 3, backgroundColor: colors.accent, borderRadius: 1.5 },
    list: { paddingHorizontal: 20, paddingBottom: 20 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      padding: 14,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    cardCompleted: { opacity: 0.45 },
    cardNextStop: { borderColor: colors.accent },
    cardGreenEdge: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 3,
      backgroundColor: colors.accent,
      borderTopLeftRadius: 14,
      borderBottomLeftRadius: 14,
    },
    inlineNav: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: 10,
      backgroundColor: colors.accent,
      borderRadius: 10,
      paddingVertical: 8,
    },
    inlineNavText: { fontSize: 13, fontWeight: '600', color: '#fff' },
    sizeBadge: { backgroundColor: colors.accentSoft, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
    sizeBadgeText: { fontSize: 11, fontWeight: '700', color: colors.accent },
    cardRow: { flexDirection: 'row', alignItems: 'center' },
    stopCircle: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.surfaceHover,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 12,
    },
    stopCircleDone: { backgroundColor: colors.accent },
    stopNum: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
    cardContent: { flex: 1 },
    cardTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    customerName: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
      flex: 1,
      marginRight: 8,
    },
    typeBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
    typeText: { fontSize: 10, fontWeight: '700' },
    address: { fontSize: 12, color: colors.textSecondary, marginBottom: 4 },
    cardMeta: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    metaText: { fontSize: 11, color: colors.textSecondary },
    overdueBadge: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.error,
      backgroundColor: colors.errorSoft,
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 4,
    },
    textFaded: { color: colors.textSecondary },
    cardNavBtn: { padding: 8, marginRight: 4 },
    emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    empty: { alignItems: 'center' },
    emptyTitle: { fontSize: 18, fontWeight: '600', color: colors.text, marginTop: 16 },
    emptyText: { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  });
