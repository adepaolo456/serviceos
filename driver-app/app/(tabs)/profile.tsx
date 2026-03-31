import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/AuthContext';
import { useAppTheme, type ThemeColors } from '../../constants/theme';

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const colors = useAppTheme();

  if (!user) return null;

  const infoRows = [
    { icon: 'mail-outline' as const, label: 'Email', value: user.email },
    { icon: 'person-outline' as const, label: 'Role', value: user.role },
    { icon: 'business-outline' as const, label: 'Tenant', value: user.tenantId },
  ];

  const s = makeStyles(colors);

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Profile</Text>
      </View>

      <View style={s.avatarSection}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>
            {user.firstName?.[0]}
            {user.lastName?.[0]}
          </Text>
        </View>
        <Text style={s.name}>
          {user.firstName} {user.lastName}
        </Text>
        <Text style={s.role}>{user.role}</Text>
      </View>

      <View style={s.card}>
        {infoRows.map((row, i) => (
          <View
            key={row.label}
            style={[s.infoRow, i < infoRows.length - 1 && s.infoRowBorder]}
          >
            <Ionicons name={row.icon} size={20} color={colors.textSecondary} style={s.infoIcon} />
            <View style={s.infoContent}>
              <Text style={s.infoLabel}>{row.label}</Text>
              <Text style={s.infoValue}>{row.value || '-'}</Text>
            </View>
          </View>
        ))}
      </View>

      <TouchableOpacity style={s.logoutBtn} onPress={logout}>
        <Ionicons name="log-out-outline" size={20} color={colors.error} />
        <Text style={s.logoutText}>Sign Out</Text>
      </TouchableOpacity>

      <Text style={s.version}>ServiceOS Driver v1.0.0</Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12 },
    headerTitle: { fontSize: 28, fontWeight: '700', color: colors.text, letterSpacing: -0.5 },
    avatarSection: { alignItems: 'center', paddingVertical: 24 },
    avatar: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: colors.accent,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 14,
    },
    avatarText: { fontSize: 28, fontWeight: '700', color: '#fff' },
    name: { fontSize: 22, fontWeight: '700', color: colors.text, letterSpacing: -0.3 },
    role: { fontSize: 14, color: colors.textSecondary, marginTop: 2, textTransform: 'capitalize' },
    card: {
      marginHorizontal: 20,
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    infoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
    },
    infoRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
    infoIcon: { marginRight: 12 },
    infoContent: { flex: 1 },
    infoLabel: { fontSize: 11, color: colors.textSecondary, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
    infoValue: { fontSize: 15, color: colors.text, fontWeight: '500' },
    logoutBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginHorizontal: 20,
      marginTop: 24,
      backgroundColor: colors.errorSoft,
      borderRadius: 14,
      paddingVertical: 14,
      gap: 8,
    },
    logoutText: { fontSize: 16, fontWeight: '600', color: colors.error },
    version: {
      textAlign: 'center',
      fontSize: 12,
      color: colors.textTertiary,
      marginTop: 24,
    },
  });
