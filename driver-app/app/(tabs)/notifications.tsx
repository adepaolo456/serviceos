import { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { useAppTheme } from '../../constants/theme';

export default function NotificationsScreen() {
  const colors = useAppTheme();

  // Placeholder notifications
  const notifications = [
    { id: '1', title: 'New job assigned', body: 'Delivery to 45 Pearl Street', time: '2 min ago', read: false },
    { id: '2', title: 'Schedule updated', body: 'Tomorrow\'s route has been optimized', time: '1 hour ago', read: true },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ padding: 20, paddingTop: 60 }}>
        <Text style={{ fontSize: 24, fontWeight: '800', color: colors.frameText }}>Notifications</Text>
      </View>
      <FlatList
        data={notifications}
        keyExtractor={item => item.id}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        renderItem={({ item }) => (
          <View style={{
            backgroundColor: colors.surface,
            borderRadius: 16, padding: 16,
            borderLeftWidth: item.read ? 0 : 3, borderLeftColor: colors.accent,
            shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 },
          }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>{item.title}</Text>
            <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 4 }}>{item.body}</Text>
            <Text style={{ fontSize: 11, color: colors.textTertiary, marginTop: 6 }}>{item.time}</Text>
          </View>
        )}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 60 }}>
            <Text style={{ fontSize: 14, color: colors.textTertiary }}>No notifications</Text>
          </View>
        }
      />
    </View>
  );
}
