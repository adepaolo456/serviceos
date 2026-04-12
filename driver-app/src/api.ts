import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

const API_BASE = 'https://serviceos-api.vercel.app';

const client = axios.create({ baseURL: API_BASE });

client.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err.response?.status === 401) {
      await SecureStore.deleteItemAsync('accessToken');
    }
    return Promise.reject(err);
  }
);

export async function login(email: string, password: string) {
  const { data } = await client.post('/auth/login', { email, password });
  await SecureStore.setItemAsync('accessToken', data.accessToken);
  return data;
}

export async function getProfile() {
  const { data } = await client.get('/auth/profile');
  return data;
}

export async function getDriverJobs(userId: string, dateFrom?: string, dateTo?: string) {
  const params: Record<string, string> = { assignedDriverId: userId, limit: '50' };
  if (dateFrom) params.dateFrom = dateFrom;
  if (dateTo) params.dateTo = dateTo;
  const { data } = await client.get('/jobs', { params });
  return data.data || data;
}

export async function getJobDetail(jobId: string) {
  const { data } = await client.get(`/jobs/${jobId}`);
  return data;
}

export async function updateJobStatus(jobId: string, status: string) {
  const { data } = await client.patch(`/jobs/${jobId}/status`, { status });
  return data;
}

export async function uploadJobPhoto(jobId: string, base64: string, type: string) {
  const { data } = await client.patch(`/driver/jobs/${jobId}/photos`, { photo: base64, type });
  return data;
}

export async function getDriverToday(userId: string) {
  const { data } = await client.get('/driver/today');
  return data;
}

export async function updateDriverJobStatus(jobId: string, status: string, signatureUrl?: string) {
  const body: Record<string, unknown> = { status };
  if (signatureUrl) body.signatureUrl = signatureUrl;
  const { data } = await client.patch(`/driver/jobs/${jobId}/status`, body);
  return data;
}

// Clock in/out
export async function clockIn(): Promise<void> {
  await client.post('/auth/clock-in');
}

export async function clockOut(): Promise<void> {
  await client.post('/auth/clock-out');
}

// Location tracking
export async function updateLocation(latitude: number, longitude: number, statusText?: string): Promise<void> {
  await client.patch('/auth/location', { latitude, longitude, statusText });
}

// Dump locations
export async function getDumpLocations(): Promise<any[]> {
  const res = await client.get('/dump-locations');
  return res.data?.data || res.data || [];
}

// Submit dump slip
export async function submitDumpSlip(jobId: string, data: {
  dumpLocationId: string;
  ticketNumber: string;
  wasteType: string;
  weightTons: number;
  surchargeItems?: Array<{ itemType: string; quantity: number }>;
}): Promise<any> {
  const res = await client.post(`/jobs/${jobId}/dump-slip`, data);
  return res.data;
}

// Get dump slips for a job
export async function getDumpSlips(jobId: string): Promise<{ tickets: any[] }> {
  const { data } = await client.get(`/jobs/${jobId}/dump-slip`);
  return data;
}

// Edit dump ticket (driver correction)
export async function updateDumpTicket(ticketId: string, updates: Record<string, unknown>): Promise<any> {
  const { data } = await client.patch(`/dump-tickets/${ticketId}`, updates);
  return data;
}

// Update job fields (driver notes, asset, etc.)
export async function updateJob(jobId: string, updates: Record<string, unknown>): Promise<any> {
  const { data } = await client.patch(`/jobs/${jobId}`, updates);
  return data;
}

// Search assets by identifier
export async function searchAssets(identifier: string): Promise<any[]> {
  const { data } = await client.get('/assets', { params: { search: identifier, limit: 5 } });
  return data.data || data || [];
}

// Phase 11A — fetch tenant-scoped assets (optionally filtered by
// subtype) for the driver completion picker. Returns both available
// and in-use so the UI can show "In Use" warning badges. Results are
// sorted server-side by status then identifier.
export async function listAssetsForPicker(subtype?: string): Promise<any[]> {
  const params: Record<string, string> = { limit: '100' };
  if (subtype) params.subtype = subtype;
  const { data } = await client.get('/assets', { params });
  return data.data || data || [];
}

// Phase 11A — office/driver asset correction endpoint. When `override`
// is true, the backend accepts assignment even if the asset is
// already on another active job, and the audit entry is marked
// `override_conflict: true`.
export async function updateJobAsset(
  jobId: string,
  assetId: string,
  options: { override?: boolean; reason?: string; sizeMismatch?: boolean } = {},
): Promise<any> {
  const { data } = await client.patch(`/jobs/${jobId}/asset`, {
    assetId,
    ...(options.override ? { overrideAssetConflict: true } : {}),
    ...(options.reason ? { reason: options.reason } : {}),
    ...(options.sizeMismatch ? { sizeMismatch: true } : {}),
  });
  return data;
}

// Phase 11A — asset-aware completion. Passes the confirmed asset in
// the same transaction as the status change so the backend's
// asset-required gate and the audit trail see it atomically.
export async function completeJobWithAsset(
  jobId: string,
  assetId: string,
  options: { override?: boolean; reason?: string } = {},
): Promise<any> {
  const { data } = await client.patch(`/jobs/${jobId}/status`, {
    status: 'completed',
    assetId,
    ...(options.override ? { overrideAssetConflict: true } : {}),
    ...(options.reason ? { assetChangeReason: options.reason } : {}),
  });
  return data;
}

// Mark job as failed
export async function failJob(jobId: string, reason: string): Promise<any> {
  const { data } = await client.patch(`/jobs/${jobId}/status`, { status: 'failed', cancellationReason: reason });
  return data;
}

// Yards
export async function getYards(): Promise<any[]> {
  const { data } = await client.get('/yards');
  return data?.data || data || [];
}

export async function stageAtYard(jobId: string, body: { yardId?: string; wasteType?: string; notes?: string }): Promise<any> {
  const { data } = await client.patch(`/driver/jobs/${jobId}/stage-at-yard`, body);
  return data;
}

export default client;
