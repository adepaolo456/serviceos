import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../constants/theme';
import { getDumpLocations, submitDumpSlip } from '../../src/api';

interface DumpLocation {
  id: string;
  name: string;
  address: string;
  city: string;
  rates: Array<{ waste_type: string; waste_type_label: string; rate_per_ton: string }>;
  surcharges: Array<{ item_type: string; label: string; dump_charge: string; customer_charge: string }>;
  fuel_env_surcharge_per_ton: string;
}

interface SurchargeEntry {
  itemType: string;
  label: string;
  quantity: number;
  charge: number;
}

const WASTE_TYPES = [
  { key: 'cnd', label: 'C&D' },
  { key: 'msw', label: 'MSW' },
  { key: 'dtm', label: 'DTM' },
  { key: 'shingles', label: 'Shingles' },
];

export default function DumpSlipScreen() {
  const { jobId, customerName } = useLocalSearchParams<{ jobId: string; customerName: string }>();
  const router = useRouter();
  const colors = useAppTheme();

  const [step, setStep] = useState(1);
  const [locations, setLocations] = useState<DumpLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [selectedLocation, setSelectedLocation] = useState<DumpLocation | null>(null);
  const [ticketNumber, setTicketNumber] = useState('');
  const [wasteType, setWasteType] = useState('');
  const [weightTons, setWeightTons] = useState('');
  const [surcharges, setSurcharges] = useState<SurchargeEntry[]>([]);
  const [dumpSlipPhoto, setDumpSlipPhoto] = useState<string | null>(null);

  useEffect(() => {
    getDumpLocations().then(setLocations).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const addSurcharge = (item: { item_type: string; label: string; customer_charge: string }) => {
    const existing = surcharges.find(s => s.itemType === item.item_type);
    if (existing) {
      setSurcharges(surcharges.map(s => s.itemType === item.item_type ? { ...s, quantity: s.quantity + 1 } : s));
    } else {
      setSurcharges([...surcharges, { itemType: item.item_type, label: item.label, quantity: 1, charge: Number(item.customer_charge) }]);
    }
  };

  const removeSurcharge = (itemType: string) => {
    setSurcharges(surcharges.filter(s => s.itemType !== itemType));
  };

  const handleSubmit = async () => {
    if (!selectedLocation || !ticketNumber || !wasteType || !weightTons) {
      Alert.alert('Missing Info', 'Please fill in all required fields');
      return;
    }
    setSubmitting(true);
    try {
      await submitDumpSlip(jobId!, {
        dumpLocationId: selectedLocation.id,
        ticketNumber,
        wasteType,
        weightTons: parseFloat(weightTons),
        surchargeItems: surcharges.map(s => ({ itemType: s.itemType, quantity: s.quantity })),
      });
      Alert.alert('Success', 'Dump slip submitted', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View style={{ paddingTop: 56, paddingHorizontal: 20, paddingBottom: 16 }}>
        <TouchableOpacity onPress={() => router.back()} style={{ marginBottom: 12 }}>
          <Ionicons name="arrow-back" size={24} color={colors.frameText} />
        </TouchableOpacity>
        <Text style={{ fontSize: 22, fontWeight: '800', color: colors.frameText }}>Dump Slip</Text>
        {customerName && <Text style={{ fontSize: 14, color: colors.frameTextMuted, marginTop: 4 }}>{customerName}</Text>}
        {/* Step indicators */}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
          {[1, 2, 3, 4].map(s => (
            <View key={s} style={{
              flex: 1, height: 4, borderRadius: 2,
              backgroundColor: s <= step ? colors.accent : colors.border,
            }} />
          ))}
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
        {/* Step 1: Select Location */}
        {step === 1 && (
          <View style={{ gap: 10 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.frameText, marginBottom: 8 }}>Select Dump Location</Text>
            {locations.map(loc => (
              <TouchableOpacity key={loc.id} onPress={() => setSelectedLocation(loc)}
                style={{
                  backgroundColor: colors.surface, borderRadius: 16, padding: 16,
                  borderWidth: selectedLocation?.id === loc.id ? 2 : 1,
                  borderColor: selectedLocation?.id === loc.id ? colors.accent : colors.border,
                }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>{loc.name}</Text>
                <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 4 }}>{loc.address}, {loc.city}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Step 2: Ticket Info */}
        {step === 2 && (
          <View style={{ gap: 16 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.frameText }}>Ticket Information</Text>
            <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16, gap: 16 }}>
              <View>
                <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 6 }}>Ticket Number</Text>
                <TextInput value={ticketNumber} onChangeText={setTicketNumber} placeholder="e.g. T-12345"
                  placeholderTextColor={colors.textTertiary}
                  style={{ backgroundColor: colors.surfaceHover, borderRadius: 12, padding: 14, fontSize: 16, color: colors.text, borderWidth: 1, borderColor: colors.border }} />
              </View>
              <View>
                <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 6 }}>Waste Type</Text>
                <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                  {WASTE_TYPES.map(wt => (
                    <TouchableOpacity key={wt.key} onPress={() => setWasteType(wt.key)}
                      style={{
                        paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
                        backgroundColor: wasteType === wt.key ? colors.accentSoft : colors.surfaceHover,
                        borderWidth: 1, borderColor: wasteType === wt.key ? colors.accent : colors.border,
                      }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: wasteType === wt.key ? colors.accent : colors.text }}>{wt.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View>
                <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: 6 }}>Weight (tons)</Text>
                <TextInput value={weightTons} onChangeText={setWeightTons} placeholder="0.00"
                  keyboardType="decimal-pad" placeholderTextColor={colors.textTertiary}
                  style={{ backgroundColor: colors.surfaceHover, borderRadius: 12, padding: 14, fontSize: 24, fontWeight: '700', color: colors.text, borderWidth: 1, borderColor: colors.border, textAlign: 'center' }} />
              </View>
            </View>
          </View>
        )}

        {/* Step 3: Surcharges */}
        {step === 3 && (
          <View style={{ gap: 16 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.frameText }}>Surcharge Items</Text>
            <Text style={{ fontSize: 13, color: colors.frameTextMuted }}>Add any special items found in the dumpster</Text>
            <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16, gap: 10 }}>
              {(selectedLocation?.surcharges || []).map(item => {
                const entry = surcharges.find(s => s.itemType === item.item_type);
                return (
                  <View key={item.item_type} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>{item.label}</Text>
                      <Text style={{ fontSize: 12, color: colors.textSecondary }}>${item.customer_charge} each</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      {entry && (
                        <TouchableOpacity onPress={() => removeSurcharge(item.item_type)}
                          style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.errorSoft, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ color: colors.error, fontWeight: '700', fontSize: 18 }}>-</Text>
                        </TouchableOpacity>
                      )}
                      <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, minWidth: 20, textAlign: 'center' }}>{entry?.quantity || 0}</Text>
                      <TouchableOpacity onPress={() => addSurcharge(item)}
                        style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: colors.accent, fontWeight: '700', fontSize: 18 }}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
              {(!selectedLocation?.surcharges || selectedLocation.surcharges.length === 0) && (
                <Text style={{ fontSize: 13, color: colors.textTertiary, textAlign: 'center', paddingVertical: 16 }}>No surcharge items available for this location</Text>
              )}
            </View>
          </View>
        )}

        {/* Step 4: Summary */}
        {step === 4 && (
          <View style={{ gap: 16 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.frameText }}>Summary</Text>
            <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16, gap: 12 }}>
              <Row label="Location" value={selectedLocation?.name || ''} colors={colors} />
              <Row label="Ticket #" value={ticketNumber} colors={colors} />
              <Row label="Waste Type" value={WASTE_TYPES.find(w => w.key === wasteType)?.label || wasteType} colors={colors} />
              <Row label="Weight" value={`${weightTons} tons`} colors={colors} />
              {surcharges.length > 0 && (
                <>
                  <View style={{ height: 1, backgroundColor: colors.borderSubtle, marginVertical: 4 }} />
                  <Text style={{ fontSize: 12, fontWeight: '600', color: colors.textSecondary }}>SURCHARGES</Text>
                  {surcharges.map(s => (
                    <Row key={s.itemType} label={`${s.label} x${s.quantity}`} value={`$${(s.quantity * s.charge).toFixed(2)}`} colors={colors} />
                  ))}
                </>
              )}
            </View>

            {/* Dump Slip Photo — REQUIRED */}
            <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16, gap: 12 }}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: '#8A8A8A', letterSpacing: 1.2, textTransform: 'uppercase' }}>DUMP SLIP PHOTO</Text>
              {dumpSlipPhoto ? (
                <>
                  <Image source={{ uri: dumpSlipPhoto }} style={{ width: '100%', height: 200, borderRadius: 14 }} resizeMode="cover" />
                  <TouchableOpacity onPress={async () => {
                    const { status } = await ImagePicker.requestCameraPermissionsAsync();
                    if (status !== 'granted') { Alert.alert('Camera permission needed'); return; }
                    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
                    if (!result.canceled && result.assets?.[0]) setDumpSlipPhoto(result.assets[0].uri);
                  }}>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: colors.accent, textAlign: 'center' }}>Retake Photo</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity onPress={async () => {
                    const { status } = await ImagePicker.requestCameraPermissionsAsync();
                    if (status !== 'granted') { Alert.alert('Camera permission needed'); return; }
                    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
                    if (!result.canceled && result.assets?.[0]) setDumpSlipPhoto(result.assets[0].uri);
                  }} style={{ backgroundColor: '#22C55E', borderRadius: 14, padding: 16, alignItems: 'center' }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>📸 Take Photo of Dump Slip</Text>
                  </TouchableOpacity>
                  <Text style={{ fontSize: 12, color: '#DC2626', textAlign: 'center' }}>Photo required before submitting</Text>
                </>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Bottom action bar */}
      <View style={{ padding: 16, paddingBottom: 32, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.frameBorder }}>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {step > 1 && (
            <TouchableOpacity onPress={() => setStep(step - 1)}
              style={{ flex: 1, paddingVertical: 16, borderRadius: 20, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>Back</Text>
            </TouchableOpacity>
          )}
          {step < 4 ? (
            <TouchableOpacity onPress={() => {
              if (step === 1 && !selectedLocation) { Alert.alert('Select a location'); return; }
              if (step === 2 && (!ticketNumber || !wasteType || !weightTons)) { Alert.alert('Fill in all fields'); return; }
              setStep(step + 1);
            }}
              style={{ flex: 1, paddingVertical: 16, borderRadius: 20, backgroundColor: colors.accent, alignItems: 'center' }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#000' }}>Next</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handleSubmit} disabled={submitting || !dumpSlipPhoto}
              style={{ flex: 1, paddingVertical: 16, borderRadius: 20, backgroundColor: colors.accent, alignItems: 'center', opacity: (submitting || !dumpSlipPhoto) ? 0.5 : 1 }}>
              {submitting ? <ActivityIndicator color="#000" /> : <Text style={{ fontSize: 15, fontWeight: '700', color: '#000' }}>Submit Dump Slip</Text>}
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

function Row({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ fontSize: 13, color: colors.textSecondary }}>{label}</Text>
      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>{value}</Text>
    </View>
  );
}
