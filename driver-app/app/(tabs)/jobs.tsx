import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format, addDays } from 'date-fns';
import { useAuth } from '../../src/AuthContext';
import { getDriverJobs } from '../../src/api';

interface Job {
  id: string;
  job_number: string;
  job_type: string;
  status: string;
  scheduled_date: string;
  scheduled_window_start: string;
  scheduled_window_end: string;
  service_address: { street?: string; city?: string; state?: string } | null;
  customer: { first_name: string; last_name: string } | null;
  asset: { identifier?: string } | null;
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
  cancelled: '#EF4444',
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
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('today');

  const fetchJobs = useCallback(async () => {
    if (!user) return;
    setLoading(true);
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
      setLoading(false);
    }
  }, [user, filter]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const filters: { key: Filter; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'completed', label: 'Completed' },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Jobs</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {filters.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterBtn, filter === f.key && styles.filterBtnActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text
              style={[
                styles.filterText,
                filter === f.key && styles.filterTextActive,
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
          <RefreshControl refreshing={loading} onRefresh={fetchJobs} tintColor="#2ECC71" />
        }
        contentContainerStyle={jobs.length === 0 ? styles.emptyContainer : styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="clipboard-outline" size={48} color="#1E2D45" />
            <Text style={styles.emptyTitle}>No jobs found</Text>
            <Text style={styles.emptyText}>Pull to refresh</Text>
          </View>
        }
        renderItem={({ item: j }) => {
          const isCompleted = j.status === 'completed';
          const addr = j.service_address;
          return (
            <TouchableOpacity
              style={[
                styles.card,
                { borderLeftColor: STATUS_COLORS[j.status] || '#71717A' },
                isCompleted && styles.cardCompleted,
              ]}
              onPress={() => router.push(`/job/${j.id}`)}
              activeOpacity={0.7}
            >
              <View style={styles.cardTop}>
                <Text style={styles.customerName} numberOfLines={1}>
                  {j.customer
                    ? `${j.customer.first_name} ${j.customer.last_name}`
                    : j.job_number}
                </Text>
                <View
                  style={[
                    styles.typeBadge,
                    {
                      backgroundColor:
                        (TYPE_COLORS[j.job_type] || '#71717A') + '20',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.typeText,
                      { color: TYPE_COLORS[j.job_type] || '#71717A' },
                    ]}
                  >
                    {j.job_type}
                  </Text>
                </View>
              </View>
              {addr && (
                <Text style={styles.address} numberOfLines={1}>
                  {[addr.street, addr.city].filter(Boolean).join(', ')}
                </Text>
              )}
              <View style={styles.cardMeta}>
                {j.scheduled_date && (
                  <Text style={styles.metaText}>
                    {format(new Date(j.scheduled_date + 'T00:00:00'), 'MMM d')}
                  </Text>
                )}
                {j.scheduled_window_start && (
                  <Text style={styles.metaText}>
                    {fmtTime(j.scheduled_window_start)}
                    {j.scheduled_window_end
                      ? ` - ${fmtTime(j.scheduled_window_end)}`
                      : ''}
                  </Text>
                )}
                {j.asset?.identifier && (
                  <Text style={styles.metaText}>{j.asset.identifier}</Text>
                )}
                <View
                  style={[
                    styles.statusBadge,
                    {
                      backgroundColor:
                        (STATUS_COLORS[j.status] || '#71717A') + '20',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusText,
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B1220' },
  header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 8 },
  headerTitle: { fontSize: 28, fontWeight: '700', color: '#fff' },
  filterRow: { paddingHorizontal: 20, paddingBottom: 12, gap: 8 },
  filterBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#111C2E',
    borderWidth: 1,
    borderColor: '#1E2D45',
  },
  filterBtnActive: { backgroundColor: '#2ECC71', borderColor: '#2ECC71' },
  filterText: { fontSize: 13, fontWeight: '600', color: '#7A8BA3' },
  filterTextActive: { color: '#fff' },
  list: { paddingHorizontal: 20, paddingBottom: 20 },
  card: {
    backgroundColor: '#111C2E',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderWidth: 1,
    borderColor: '#1E2D45',
  },
  cardCompleted: { opacity: 0.5 },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  customerName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    flex: 1,
    marginRight: 8,
  },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  typeText: { fontSize: 10, fontWeight: '700', textTransform: 'capitalize' },
  address: { fontSize: 12, color: '#7A8BA3', marginBottom: 4 },
  cardMeta: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  metaText: { fontSize: 11, color: '#7A8BA3' },
  statusBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { alignItems: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#fff', marginTop: 16 },
  emptyText: { fontSize: 14, color: '#7A8BA3', marginTop: 4 },
});
