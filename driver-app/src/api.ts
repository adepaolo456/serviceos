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

export default client;
