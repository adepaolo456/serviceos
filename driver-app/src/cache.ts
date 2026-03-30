import AsyncStorage from '@react-native-async-storage/async-storage';

export async function cacheRoute(date: string, jobs: unknown[]) {
  try { await AsyncStorage.setItem(`cached_route_${date}`, JSON.stringify(jobs)); } catch {}
}

export async function getCachedRoute(date: string): Promise<unknown[] | null> {
  try {
    const raw = await AsyncStorage.getItem(`cached_route_${date}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export async function queueStatusUpdate(jobId: string, status: string) {
  try {
    const raw = await AsyncStorage.getItem('pending_status_updates');
    const queue: Array<{ jobId: string; status: string; timestamp: number }> = raw ? JSON.parse(raw) : [];
    queue.push({ jobId, status, timestamp: Date.now() });
    await AsyncStorage.setItem('pending_status_updates', JSON.stringify(queue));
  } catch {}
}

export async function getPendingUpdates(): Promise<Array<{ jobId: string; status: string; timestamp: number }>> {
  try {
    const raw = await AsyncStorage.getItem('pending_status_updates');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export async function clearPendingUpdates() {
  try { await AsyncStorage.removeItem('pending_status_updates'); } catch {}
}
