import { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
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
  placement_notes?: string;
  driver_notes?: string;
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

function getNextAction(status: string): { label: string; color: string } {
  switch (status) {
    case 'confirmed': case 'dispatched': return { label: 'On My Way →', color: '#22C55E' };
    case 'en_route': return { label: 'Arrived →', color: '#3B82F6' };
    case 'arrived': case 'in_progress': return { label: 'Complete →', color: '#D97706' };
    case 'completed': return { label: '✓ Done', color: '#9CA3AF' };
    default: return { label: status.replace(/_/g, ' '), color: '#9CA3AF' };
  }
}

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
    } catch {} finally { setLoading(false); }
  }, [user, today]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const completed = jobs.filter((j) => j.status === 'completed').length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12 }}>
        <Text style={{ fontSize: 28, fontWeight: '800', color: colors.frameText, letterSpacing: -0.5 }}>Today's Route</Text>
        <Text style={{ fontSize: 14, color: colors.frameTextMuted, marginTop: 2 }}>{format(new Date(), 'EEEE, MMMM d')}</Text>
        <TouchableOpacity
          onPress={async () => { try { if (isClockedIn) await doClockOut(); else await doClockIn(); } catch {} }}
          style={{
            backgroundColor: isClockedIn ? 'rgba(220,38,38,0.1)' : 'rgba(34,197,94,0.1)',
            paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
            alignSelf: 'flex-start', marginTop: 10,
          }}>
          <Text style={{ color: isClockedIn ? colors.error : colors.accent, fontSize: 13, fontWeight: '700' }}>
            {isClockedIn ? '⏹ Clock Out' : '▶ Clock In'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Progress */}
      {jobs.length > 0 && (
        <View style={{ marginHorizontal: 20, marginBottom: 14, backgroundColor: colors.surface, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.border }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>{completed} of {jobs.length} stops</Text>
            <Text style={{ fontSize: 13, fontWeight: '700', color: colors.accent }}>{Math.round((completed / jobs.length) * 100)}%</Text>
          </View>
          <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: 'hidden' }}>
            <View style={{ height: 4, backgroundColor: colors.accent, borderRadius: 2, width: `${(completed / jobs.length) * 100}%` as any }} />
          </View>
        </View>
      )}

      {/* Job tiles */}
      <FlatList
        data={jobs}
        keyExtractor={(j) => j.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchJobs} tintColor={colors.accent} />}
        contentContainerStyle={jobs.length === 0 ? { flex: 1, justifyContent: 'center', alignItems: 'center' } : { paddingHorizontal: 20, paddingBottom: 20 }}
        ListEmptyComponent={
          <View style={{ alignItems: 'center' }}>
            <Ionicons name="sunny" size={48} color={colors.textTertiary} />
            <Text style={{ fontSize: 18, fontWeight: '600', color: colors.frameText, marginTop: 16 }}>No jobs today</Text>
            <Text style={{ fontSize: 14, color: colors.frameTextMuted, marginTop: 4 }}>Enjoy your day off!</Text>
          </View>
        }
        renderItem={({ item: j, index }) => {
          const isDone = j.status === 'completed';
          const isNext = !isDone && jobs.findIndex(x => x.status !== 'completed' && x.status !== 'cancelled') === index;
          const action = getNextAction(j.status);
          const hasNotes = !!(j.placement_notes || j.driver_notes);
          const typeColor = TYPE_COLORS[j.job_type] || '#9CA3AF';
          const typeLabel = TYPE_LABELS[j.job_type] || j.job_type;
          const size = j.asset?.subtype || '';

          return (
            <TouchableOpacity
              onPress={() => router.push(`/job/${j.id}`)}
              activeOpacity={0.7}
              style={{
                backgroundColor: '#FFFFFF',
                borderRadius: 20,
                padding: 20,
                marginBottom: 12,
                borderWidth: isNext ? 2 : 1,
                borderColor: isNext ? '#22C55E' : '#E5E5E5',
                opacity: isDone ? 0.45 : 1,
                shadowColor: isNext ? '#22C55E' : '#000',
                shadowOpacity: isNext ? 0.15 : 0.06,
                shadowRadius: isNext ? 16 : 8,
                shadowOffset: { width: 0, height: isNext ? 4 : 2 },
                overflow: 'hidden',
              }}
            >
              {/* Left color stripe */}
              <View style={{ position: 'absolute', left: 0, top: 10, bottom: 10, width: 5, borderRadius: 3, backgroundColor: typeColor }} />

              {/* ROW 1: Size + Type (biggest text) */}
              <View style={{ flexDirection: 'row', alignItems: 'baseline', paddingLeft: 8 }}>
                <Text style={{ fontSize: 22, fontWeight: '800', color: '#0A0A0A', letterSpacing: -0.5 }}>
                  {size ? `${size} ` : ''}{' '}
                </Text>
                <Text style={{ fontSize: 22, fontWeight: '800', color: typeColor }}>
                  {typeLabel}
                </Text>
              </View>

              {/* ROW 2: Customer name */}
              <Text style={{ fontSize: 17, fontWeight: '600', color: '#0A0A0A', marginTop: 8, paddingLeft: 8 }}>
                {j.customer ? `${j.customer.first_name} ${j.customer.last_name}` : j.job_number}
              </Text>

              {/* ROW 3: Status / next action */}
              <Text style={{ fontSize: 14, fontWeight: '600', color: action.color, marginTop: 6, paddingLeft: 8 }}>
                {isDone && <Ionicons name="checkmark-circle" size={14} color="#22C55E" />}
                {' '}{action.label}
              </Text>

              {/* ROW 4: Optional badges */}
              {(j.asset?.identifier || hasNotes || j.scheduled_window_start || j.is_overdue) && (
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8, paddingLeft: 8 }}>
                  {j.asset?.identifier && (
                    <View style={{ backgroundColor: 'rgba(34,197,94,0.08)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#22C55E' }}>{j.asset.identifier}</Text>
                    </View>
                  )}
                  {hasNotes && <Text style={{ fontSize: 12, color: '#D97706' }}>📝</Text>}
                  {j.scheduled_window_start && (
                    <Text style={{ fontSize: 12, color: '#8A8A8A' }}>
                      {fmtTime(j.scheduled_window_start)}{j.scheduled_window_end ? `–${fmtTime(j.scheduled_window_end)}` : ''}
                    </Text>
                  )}
                  {j.is_overdue && (
                    <View style={{ backgroundColor: 'rgba(220,38,38,0.08)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: '#DC2626' }}>OVERDUE {j.extra_days}d</Text>
                    </View>
                  )}
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}
