import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useAuth } from '../../src/AuthContext';
import { getDriverJobs } from '../../src/api';

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
  cancelled: '#EF4444',
};

function fmtTime(t: string | null) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hr = parseInt(h);
  return `${hr === 0 ? 12 : hr > 12 ? hr - 12 : hr}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
}

export default function TodayScreen() {
  const { user } = useAuth();
  const router = useRouter();
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Today's Route</Text>
        <Text style={styles.headerDate}>{format(new Date(), 'EEEE, MMMM d')}</Text>
      </View>

      {jobs.length > 0 && (
        <View style={styles.progressCard}>
          <Text style={styles.progressText}>
            {completed} of {jobs.length} stops completed
          </Text>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
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
          <RefreshControl refreshing={loading} onRefresh={fetchJobs} tintColor="#2ECC71" />
        }
        contentContainerStyle={jobs.length === 0 ? styles.emptyContainer : styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="sunny" size={48} color="#1E2D45" />
            <Text style={styles.emptyTitle}>No jobs today</Text>
            <Text style={styles.emptyText}>Enjoy your day off!</Text>
          </View>
        }
        renderItem={({ item: j, index }) => {
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
              <View style={styles.cardRow}>
                <View style={[styles.stopCircle, isCompleted && styles.stopCircleDone]}>
                  {isCompleted ? (
                    <Ionicons name="checkmark" size={14} color="#fff" />
                  ) : (
                    <Text style={styles.stopNum}>{index + 1}</Text>
                  )}
                </View>
                <View style={styles.cardContent}>
                  <View style={styles.cardTop}>
                    <Text
                      style={[styles.customerName, isCompleted && styles.textFaded]}
                      numberOfLines={1}
                    >
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
                        {TYPE_LABELS[j.job_type] || j.job_type}
                      </Text>
                    </View>
                  </View>
                  {addr && (
                    <Text
                      style={[styles.address, isCompleted && styles.textFaded]}
                      numberOfLines={1}
                    >
                      {[addr.street, addr.city].filter(Boolean).join(', ')}
                    </Text>
                  )}
                  <View style={styles.cardMeta}>
                    {j.asset?.identifier && (
                      <Text style={styles.metaText}>{j.asset.identifier}</Text>
                    )}
                    {j.scheduled_window_start && (
                      <Text style={styles.metaText}>
                        {fmtTime(j.scheduled_window_start)}
                        {j.scheduled_window_end
                          ? ` - ${fmtTime(j.scheduled_window_end)}`
                          : ''}
                      </Text>
                    )}
                    {j.is_overdue && (
                      <Text style={styles.overdueBadge}>OVERDUE {j.extra_days}d</Text>
                    )}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#7A8BA3" />
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
  header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12 },
  headerTitle: { fontSize: 28, fontWeight: '700', color: '#fff' },
  headerDate: { fontSize: 14, color: '#7A8BA3', marginTop: 2 },
  progressCard: {
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: '#111C2E',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1E2D45',
  },
  progressText: { fontSize: 13, fontWeight: '600', color: '#fff', marginBottom: 8 },
  progressBar: {
    height: 4,
    backgroundColor: '#1E2D45',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: { height: 4, backgroundColor: '#2ECC71', borderRadius: 2 },
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
  cardRow: { flexDirection: 'row', alignItems: 'center' },
  stopCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1E2D45',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  stopCircleDone: { backgroundColor: '#2ECC71' },
  stopNum: { fontSize: 12, fontWeight: '700', color: '#7A8BA3' },
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
    color: '#fff',
    flex: 1,
    marginRight: 8,
  },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  typeText: { fontSize: 10, fontWeight: '700' },
  address: { fontSize: 12, color: '#7A8BA3', marginBottom: 4 },
  cardMeta: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  metaText: { fontSize: 11, color: '#7A8BA3' },
  overdueBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: '#EF4444',
    backgroundColor: 'rgba(239,68,68,0.1)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  textFaded: { color: '#7A8BA3' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { alignItems: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#fff', marginTop: 16 },
  emptyText: { fontSize: 14, color: '#7A8BA3', marginTop: 4 },
});
