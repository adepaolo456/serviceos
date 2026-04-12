import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ScrollView,
  AppState,
  AppStateStatus,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format, addDays } from 'date-fns';
import { useAuth } from '../../src/AuthContext';
import { getDriverJobs } from '../../src/api';
import { useAppTheme, type ThemeColors } from '../../constants/theme';

interface Job {
  id: string;
  job_number: string;
  job_type: string;
  status: string;
  asset_subtype?: string;
  scheduled_date: string;
  scheduled_window_start: string;
  scheduled_window_end: string;
  service_address: { street?: string; city?: string; state?: string } | null;
  customer: { first_name: string; last_name: string } | null;
  asset: { identifier?: string; subtype?: string } | null;
}

type Filter = 'today' | 'upcoming' | 'completed';

const TYPE_COLORS: Record<string, string> = {
  delivery: '#3B82F6',
  pickup: '#F97316',
  exchange: '#8B5CF6',
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

export default function JobsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const colors = useAppTheme();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('today');

  const fetchJobs = useCallback(async (silent = false) => {
    if (!user) return;
    if (!silent) setLoading(true);
    try {
      const today = format(new Date(), 'yyyy-MM-dd');
      let dateFrom: string | undefined;
      let dateTo: string | undefined;

      if (filter === 'today') {
        dateFrom = today;
        dateTo = today;
      } else if (filter === 'upcoming') {
        dateFrom = format(addDays(new Date(), 1), 'yyyy-MM-dd');
        dateTo = format(addDays(new Date(), 14), 'yyyy-MM-dd');
      } else {
        // completed — fetch last 30 days
        dateFrom = format(addDays(new Date(), -30), 'yyyy-MM-dd');
        dateTo = today;
      }

      const data = await getDriverJobs(user.id, dateFrom, dateTo);
      let list = Array.isArray(data) ? data : [];
      if (filter === 'completed') {
        list = list.filter((j: Job) => j.status === 'completed');
      }
      setJobs(list);
    } catch {
      /* ignore */
    } finally {
      if (!silent) setLoading(false);
    }
  }, [user, filter]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Phase 9 — quiet auto-sync so upcoming/today lists stay correct
  // after dispatcher reschedules without a manual pull-to-refresh.
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => { fetchJobs(true); }, 30000);
    return () => clearInterval(interval);
  }, [user, fetchJobs]);

  useFocusEffect(
    useCallback(() => {
      fetchJobs(true);
    }, [fetchJobs]),
  );

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        next === 'active'
      ) {
        fetchJobs(true);
      }
      appStateRef.current = next;
    });
    return () => sub.remove();
  }, [fetchJobs]);

  const filters: { key: Filter; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'completed', label: 'Completed' },
  ];

  const s = makeStyles(colors);

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Jobs</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.filterRow}
      >
        {filters.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[s.filterBtn, filter === f.key && s.filterBtnActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text
              style={[
                s.filterText,
                filter === f.key && s.filterTextActive,
              ]}
            >
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        data={jobs}
        keyExtractor={(j) => j.id}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={fetchJobs} tintColor={colors.accent} />
        }
        contentContainerStyle={jobs.length === 0 ? s.emptyContainer : s.list}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="clipboard-outline" size={48} color={colors.textTertiary} />
            <Text style={s.emptyTitle}>No jobs found</Text>
            <Text style={s.emptyText}>Pull to refresh</Text>
          </View>
        }
        renderItem={({ item: j }) => {
          const isCompleted = j.status === 'completed';
          const addr = j.service_address;
          const sizeRaw = j.asset_subtype || j.asset?.subtype; // e.g. "20yd"
          const sizeAbbr = sizeRaw
            ? sizeRaw.replace(/[^0-9]/g, '') + 'Y'
            : '—';
          return (
            <TouchableOpacity
              style={[
                s.card,
                isCompleted && s.cardCompleted,
              ]}
              onPress={() => router.push(`/job/${j.id}`)}
              activeOpacity={0.7}
            >
              <View style={[
                s.cardLeftEdge,
                { backgroundColor: STATUS_COLORS[j.status] || '#71717A' },
              ]} />
              {/* Primary line: Size + Type + Address */}
              <View style={s.cardPrimary}>
                <Text style={s.sizeAbbr}>{sizeAbbr}</Text>
                <Text style={[s.primaryType, { color: TYPE_COLORS[j.job_type] || '#71717A' }]}>
                  {j.job_type.toUpperCase()}
                </Text>
                {addr && (
                  <Text style={s.primaryAddress} numberOfLines={1}>
                    {[addr.street, addr.city].filter(Boolean).join(', ')}
                  </Text>
                )}
              </View>
              {/* Secondary: customer name */}
              <Text style={s.customerName} numberOfLines={1}>
                {j.customer
                  ? `${j.customer.first_name} ${j.customer.last_name}`
                  : j.job_number}
              </Text>
              <View style={s.cardMeta}>
                {j.scheduled_date && (
                  <Text style={s.metaText}>
                    {format(new Date(j.scheduled_date + 'T00:00:00'), 'MMM d')}
                  </Text>
                )}
                {j.scheduled_window_start && (
                  <Text style={s.metaText}>
                    {fmtTime(j.scheduled_window_start)}
                    {j.scheduled_window_end
                      ? ` - ${fmtTime(j.scheduled_window_end)}`
                      : ''}
                  </Text>
                )}
                {j.asset?.identifier && (
                  <Text style={s.metaText}>{j.asset.identifier}</Text>
                )}
                <View
                  style={[
                    s.statusBadge,
                    {
                      backgroundColor:
                        (STATUS_COLORS[j.status] || '#71717A') + '14',
                    },
                  ]}
                >
                  <Text
                    style={[
                      s.statusText,
                      { color: STATUS_COLORS[j.status] || '#71717A' },
                    ]}
                  >
                    {j.status.replace(/_/g, ' ')}
                  </Text>
                </View>
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
    header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 8 },
    headerTitle: { fontSize: 28, fontWeight: '700', color: colors.text, letterSpacing: -0.5 },
    filterRow: { paddingHorizontal: 20, paddingBottom: 12, gap: 8 },
    filterBtn: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 20,
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: colors.border,
    },
    filterBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    filterText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
    filterTextActive: { color: '#fff' },
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
    cardLeftEdge: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 3,
      borderTopLeftRadius: 14,
      borderBottomLeftRadius: 14,
    },
    cardCompleted: { opacity: 0.45 },
    cardPrimary: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 4,
      gap: 8,
    },
    sizeAbbr: {
      fontSize: 18,
      fontWeight: '900',
      color: colors.text,
    },
    primaryType: {
      fontSize: 13,
      fontWeight: '700',
    },
    primaryAddress: {
      fontSize: 13,
      color: colors.textSecondary,
      flex: 1,
    },
    customerName: {
      fontSize: 13,
      fontWeight: '500',
      color: colors.textSecondary,
      marginBottom: 4,
    },
    cardMeta: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
    metaText: { fontSize: 11, color: colors.textSecondary },
    statusBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
    statusText: {
      fontSize: 10,
      fontWeight: '700',
      textTransform: 'capitalize',
    },
    emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    empty: { alignItems: 'center' },
    emptyTitle: { fontSize: 18, fontWeight: '600', color: colors.text, marginTop: 16 },
    emptyText: { fontSize: 14, color: colors.textSecondary, marginTop: 4 },
  });
