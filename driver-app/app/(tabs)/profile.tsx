import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/AuthContext';

export default function ProfileScreen() {
  const { user, logout } = useAuth();

  if (!user) return null;

  const infoRows = [
    { icon: 'mail-outline' as const, label: 'Email', value: user.email },
    { icon: 'person-outline' as const, label: 'Role', value: user.role },
    { icon: 'business-outline' as const, label: 'Tenant', value: user.tenantId },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <View style={styles.avatarSection}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {user.firstName?.[0]}
            {user.lastName?.[0]}
          </Text>
        </View>
        <Text style={styles.name}>
          {user.firstName} {user.lastName}
        </Text>
        <Text style={styles.role}>{user.role}</Text>
      </View>

      <View style={styles.card}>
        {infoRows.map((row, i) => (
          <View
            key={row.label}
            style={[styles.infoRow, i < infoRows.length - 1 && styles.infoRowBorder]}
          >
            <Ionicons name={row.icon} size={20} color="#7A8BA3" style={styles.infoIcon} />
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>{row.label}</Text>
              <Text style={styles.infoValue}>{row.value || '-'}</Text>
            </View>
          </View>
        ))}
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
        <Ionicons name="log-out-outline" size={20} color="#EF4444" />
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>

      <Text style={styles.version}>ServiceOS Driver v1.0.0</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B1220' },
  header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12 },
  headerTitle: { fontSize: 28, fontWeight: '700', color: '#fff' },
  avatarSection: { alignItems: 'center', paddingVertical: 24 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#2ECC71',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarText: { fontSize: 24, fontWeight: '700', color: '#0B1220' },
  name: { fontSize: 20, fontWeight: '700', color: '#fff' },
  role: { fontSize: 14, color: '#7A8BA3', marginTop: 2, textTransform: 'capitalize' },
  card: {
    marginHorizontal: 20,
    backgroundColor: '#111C2E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2D45',
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  infoRowBorder: { borderBottomWidth: 1, borderBottomColor: '#1E2D45' },
  infoIcon: { marginRight: 12 },
  infoContent: { flex: 1 },
  infoLabel: { fontSize: 11, color: '#7A8BA3', marginBottom: 2 },
  infoValue: { fontSize: 14, color: '#fff' },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 20,
    marginTop: 24,
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 12,
    paddingVertical: 14,
    gap: 8,
  },
  logoutText: { fontSize: 16, fontWeight: '600', color: '#EF4444' },
  version: {
    textAlign: 'center',
    fontSize: 12,
    color: '#7A8BA3',
    marginTop: 24,
  },
});
